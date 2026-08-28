import { Logger } from '@nestjs/common';
import { Task, TaskStatus } from '@prisma/client';
import { z } from 'zod';

const logger = new Logger('MeetingTools');

/**
 * The `meeting` server name and each tool's fully-qualified MCP name
 * (`mcp__<server>__<tool>`) — the form `Options.allowedTools` expects. Exported so a caller wiring
 * `createMeetingToolsServer` into `options.mcpServers` can build `options.allowedTools` from the
 * same source instead of re-typing these strings (and risking a typo that silently drops a tool).
 */
export const MEETING_TOOLS_SERVER_NAME = 'meeting';
/** Must match the string literal passed as each tool's own name in `createMeetingTools` below. */
export const MEETING_TOOL_NAMES = [
  'find_tasks',
  'upsert_task',
  'update_meeting',
] as const;
export const MEETING_ALLOWED_TOOLS = MEETING_TOOL_NAMES.map(
  (name) => `mcp__${MEETING_TOOLS_SERVER_NAME}__${name}`,
);

/**
 * Structural subsets of `TaskService`/`MeetingSummaryService` — just what the tools below call.
 * Typed this way (rather than importing the concrete classes from `./tasks/tasks.service` and
 * `./meeting-summary/meeting-summary.service`) so this file has no import edge into either module;
 * `MeetingSummaryService.summarize` importing `createMeetingToolsServer` from here while also being
 * the value passed in as `meetingSummaryService` would otherwise be a circular module import.
 */
export interface TaskLookup {
  search(query: string): Promise<Task[]>;
  upsert(input: {
    title: string;
    status?: TaskStatus;
    sourceMeetingId: string;
  }): Promise<Task>;
}

export interface MeetingSummaryWriter {
  updateContent(
    meetingId: string,
    summaryText: string,
    decisions: string[],
  ): Promise<unknown>;
}

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

/**
 * The `meeting` tool set: a thin tool-call adapter over this app's existing Prisma-backed services
 * (`TaskService`, `MeetingSummaryService`) rather than new business logic — every tool below
 * delegates straight to the service method it wraps. Split out from `createMeetingToolsServer` so
 * each tool's `handler` can be unit-tested directly, without going through the MCP server/transport
 * layer `createSdkMcpServer` builds around it.
 *
 * `meetingId` is the meeting this tool set is scoped to, fixed by the caller at creation time —
 * NOT a tool argument the model fills in. `upsert_task`/`update_meeting` always write against this
 * `meetingId`, closed over rather than accepted in their input schema, so nothing the model reads
 * from the transcript (including an attempt at prompt injection) can redirect a write to a
 * different meeting. This alone isn't sufficient, though: `TaskService.upsert`'s own dedup lookup
 * (used by `upsert_task`) is itself scoped to `sourceMeetingId` — it only ever updates a task that
 * already belongs to this meeting, never one matched purely by a similar title from a different
 * meeting — otherwise a crafted/coincidental title alone (no meeting id involved) could still let
 * one meeting's transcript silently rewrite another meeting's task. `find_tasks`'s own lookup stays
 * meeting-agnostic on purpose (see its own doc comment) — it's read-only, so it can safely surface
 * a similar task from elsewhere for the model's awareness without any risk of mutating it.
 *
 * `@anthropic-ai/claude-agent-sdk` is ESM-only, while this app compiles to CommonJS, so `tool` is
 * loaded via a dynamic `import()` rather than a static one — the same reason
 * `claude-agent.module.ts`'s `runClaudeAgent` does.
 */
export async function createMeetingTools(
  meetingId: string,
  taskService: TaskLookup,
  meetingSummaryService: MeetingSummaryWriter,
) {
  const { tool } = await import('@anthropic-ai/claude-agent-sdk');

  const findTasks = tool(
    'find_tasks',
    "Finds existing tasks whose title is textually similar to the given query, most similar match first. Use this before creating a task to check whether it already exists. Doesn't change any data.",
    {
      query: z
        .string()
        .min(1)
        .describe('Free text to match task titles against'),
    },
    async ({ query }) => {
      logger.log(
        `find_tasks meetingId=${meetingId} query=${JSON.stringify(query)}`,
      );
      const matches = await taskService.search(query);
      logger.log(
        `find_tasks meetingId=${meetingId} -> ${matches.length} match(es): ${matches.map((m) => m.id).join(', ')}`,
      );
      return textResult(matches);
    },
    { annotations: { readOnlyHint: true } },
  );

  const upsertTask = tool(
    'upsert_task',
    "Creates a task with the given title for the current meeting, or updates the closest existing similar task's title/status instead of creating a duplicate — only ever matching among this same meeting's own tasks.",
    {
      title: z.string().min(1),
      status: z
        .nativeEnum(TaskStatus)
        .optional()
        .describe(
          'Left unchanged on an update, defaults to OPEN on a new task',
        ),
    },
    async ({ title, status }) => {
      logger.log(
        `upsert_task meetingId=${meetingId} title=${JSON.stringify(title)} status=${status ?? '(unset)'}`,
      );
      const task = await taskService.upsert({
        title,
        status,
        sourceMeetingId: meetingId,
      });
      logger.log(
        `upsert_task meetingId=${meetingId} -> id=${task.id} status=${task.status}`,
      );
      return textResult(task);
    },
  );

  const updateMeeting = tool(
    'update_meeting',
    "Writes the current meeting's summary text and list of decisions.",
    {
      summary: z.string().min(1),
      decisions: z.array(z.string().min(1)),
    },
    async ({ summary, decisions }) => {
      logger.log(
        `update_meeting meetingId=${meetingId} summaryLength=${summary.length} decisions=${decisions.length}`,
      );
      const updated = await meetingSummaryService.updateContent(
        meetingId,
        summary,
        decisions,
      );
      if (!updated) {
        logger.warn(
          `update_meeting meetingId=${meetingId} -> meeting not found`,
        );
        return errorResult(`Meeting ${meetingId} does not exist.`);
      }
      logger.log(`update_meeting meetingId=${meetingId} -> ok`);
      return textResult(updated);
    },
  );

  return [findTasks, upsertTask, updateMeeting];
}

/**
 * Registers `createMeetingTools`'s tools — scoped to `meetingId`, see above — as the `meeting` SDK
 * MCP server. Callers get the resulting `McpSdkServerConfigWithInstance` under
 * `options.mcpServers.meeting` on a `ClaudeAgentService.ask` call that wants an agent able to look
 * up/record tasks and write a meeting's summary — combine with `options.allowedTools:
 * MEETING_ALLOWED_TOOLS` so the agent can't also reach whatever other tools/servers that same
 * `query()` call happens to have configured.
 */
export async function createMeetingToolsServer(
  meetingId: string,
  taskService: TaskLookup,
  meetingSummaryService: MeetingSummaryWriter,
) {
  const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({
    name: MEETING_TOOLS_SERVER_NAME,
    tools: await createMeetingTools(
      meetingId,
      taskService,
      meetingSummaryService,
    ),
  });
}
