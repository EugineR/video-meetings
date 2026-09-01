import { Task, TaskStatus } from '@prisma/client';
import { z } from 'zod';

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
    ownerId?: string;
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
 * `ownerId` — the target meeting's owner, resolved by the caller (`SummaryReconciliationService`,
 * via `MeetingsRepository.findById`) and passed down through `MeetingSummaryService.generateForMeeting`/
 * `summarize` — is closed over the same way `meetingId` is, for the same reason: it must never
 * become a tool argument the model could try to fill in. `upsert_task` writes it onto every task it
 * creates or matches, so a task the background agent creates is attributed to the meeting's real
 * owner rather than left ownerless — which is what makes it visible at all to `/mcp`'s
 * owner-scoped `find_tasks`/`task-tools.ts` reads (see `apps/api/CLAUDE.md`'s Invariants).
 *
 * `@anthropic-ai/claude-agent-sdk` is ESM-only, while this app compiles to CommonJS, so `tool` is
 * loaded via a dynamic `import()` rather than a static one — the same reason
 * `claude-agent.module.ts`'s `runClaudeAgent` does.
 *
 * None of these handlers log their own call/result — `auditLog` (`./hooks`), wired into every
 * agent run's `options.hooks.PostToolUse` by `runClaudeAgent`, already logs every tool call's name,
 * arguments and result centrally; a per-handler `Logger` call here would just duplicate that.
 */
export async function createMeetingTools(
  meetingId: string,
  ownerId: string,
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
      const matches = await taskService.search(query);
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
      const task = await taskService.upsert({
        title,
        status,
        sourceMeetingId: meetingId,
        ownerId,
      });
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
      const updated = await meetingSummaryService.updateContent(
        meetingId,
        summary,
        decisions,
      );
      if (!updated) {
        return errorResult(`Meeting ${meetingId} does not exist.`);
      }
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
  ownerId: string,
  taskService: TaskLookup,
  meetingSummaryService: MeetingSummaryWriter,
) {
  const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  return createSdkMcpServer({
    name: MEETING_TOOLS_SERVER_NAME,
    tools: await createMeetingTools(
      meetingId,
      ownerId,
      taskService,
      meetingSummaryService,
    ),
  });
}
