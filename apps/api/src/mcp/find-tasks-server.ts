import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { TaskService } from '../tasks/tasks.service';

const SERVER_NAME = 'find-tasks';
const SERVER_VERSION = '1.0.0';

/**
 * DI context for this standalone process, scoped to exactly what `find_tasks`/`upsert_task`/
 * `gather_meeting_info` need rather than the full `AppModule` — this process has no HTTP surface
 * and never touches transcription or the Claude Agent SDK. `JwtModule` (verify-only here — nothing
 * in this process signs a token) and `MeetingsRepository` (imported directly rather than the whole
 * `MeetingsModule`, which would drag in Whisper/Claude Agent SDK dependencies this process has no
 * use for) back the ownership check every tool and the prompt run before touching `TaskService` —
 * see `registerFindTasks`/`registerUpsertTask`/`registerGatherMeetingInfoPrompt`'s own doc comments
 * for why that's needed.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    PrismaModule,
    TasksModule,
  ],
  providers: [MeetingsRepository],
})
class FindTasksContextModule {}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/**
 * Registers the `find_tasks` tool against the real `TaskService.search` (the same
 * pg_trgm-backed lookup `meeting-tools.ts`'s `find_tasks` SDK tool calls), scoped to `meetingId`
 * and gated on `userId` actually owning that meeting.
 *
 * This process is reachable by any MCP client that can spawn it — unlike `meeting-tools.ts`'s
 * in-process tool, `meetingId` isn't a value this server can close over at creation time, and it
 * can't rely on `TaskService.search`'s meeting-agnostic default either: without both the
 * `meetingId` argument and this ownership check, any caller could read any user's task titles
 * across every meeting in the database. `MeetingsRepository.findByIdAndOwner` returns `null` both
 * when the meeting doesn't exist and when it belongs to someone else, and both cases get the same
 * generic error message here — mirroring this app's own "a foreign resource 404s, never 403s"
 * rule (`apps/api/CLAUDE.md`'s Invariants), so a caller can't use this tool to probe which meeting
 * ids exist.
 */
function registerFindTasks(
  server: McpServer,
  taskService: TaskService,
  meetingsRepository: MeetingsRepository,
  userId: string,
) {
  server.registerTool(
    'find_tasks',
    {
      description:
        "Finds tasks belonging to the given meeting whose title is textually similar to the given query, most similar match first. Use this before creating a task to check whether it already exists. Doesn't change any data.",
      inputSchema: {
        meetingId: z
          .string()
          .uuid()
          .describe('The meeting whose tasks to search'),
        query: z
          .string()
          .min(1)
          .describe('Free text to match task titles against'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ meetingId, query }) => {
      const meeting = await meetingsRepository.findByIdAndOwner(
        meetingId,
        userId,
      );
      if (!meeting) {
        return errorResult(`Meeting ${meetingId} not found.`);
      }

      const matches = await taskService.search(query, meetingId);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(matches) }],
      };
    },
  );
}

/**
 * Registers the `upsert_task` tool against the real `TaskService.upsert` (the same dedup-aware
 * create-or-update `meeting-tools.ts`'s in-process `upsert_task` calls), gated on the same
 * `meetingId` + ownership check as `registerFindTasks` above — `TaskService.upsert`'s dedup lookup
 * is itself scoped to `sourceMeetingId` (see its own doc comment), so skipping this check here would
 * let any caller create or silently rewrite a task in a meeting they don't own.
 */
function registerUpsertTask(
  server: McpServer,
  taskService: TaskService,
  meetingsRepository: MeetingsRepository,
  userId: string,
) {
  server.registerTool(
    'upsert_task',
    {
      description:
        "Creates a task with the given title for the given meeting, or updates the closest existing similar task's title/status instead of creating a duplicate — only ever matching among that same meeting's own tasks.",
      inputSchema: {
        meetingId: z
          .string()
          .uuid()
          .describe('The meeting to create or update the task in'),
        title: z.string().min(1),
        status: z
          .nativeEnum(TaskStatus)
          .optional()
          .describe(
            'Left unchanged on an update, defaults to OPEN on a new task',
          ),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ meetingId, title, status }) => {
      const meeting = await meetingsRepository.findByIdAndOwner(
        meetingId,
        userId,
      );
      if (!meeting) {
        return errorResult(`Meeting ${meetingId} not found.`);
      }

      const task = await taskService.upsert({
        title,
        status,
        sourceMeetingId: meetingId,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task) }],
      };
    },
  );
}

/**
 * Registers the `gather_meeting_info` prompt: a reusable template, gated on the same `meetingId` +
 * ownership check as the two tools above, that seeds a conversation with one meeting's own
 * `title`/`date`/`participants` and instructs the assistant to interview the caller about what was
 * discussed and use `find_tasks`/`upsert_task` (scoped to that same `meetingId`) to record what it
 * learns — a template a client offers a human to kick off gathering a meeting's action items,
 * rather than a tool an agent calls mid-task.
 *
 * Unlike `registerTool`'s `errorResult` (a normal `CallToolResult` with `isError: true`), the MCP
 * `prompts/get` response (`GetPromptResult`) has no error field of its own — a failed ownership
 * check here throws instead, which the SDK surfaces as a JSON-RPC error to the client. The message
 * is still the same generic "not found" text `find_tasks`/`upsert_task` use for both "doesn't
 * exist" and "isn't yours", for the same reason: never let a caller distinguish the two.
 */
function registerGatherMeetingInfoPrompt(
  server: McpServer,
  meetingsRepository: MeetingsRepository,
  userId: string,
) {
  server.registerPrompt(
    'gather_meeting_info',
    {
      title: 'Gather meeting info',
      description:
        "Seeds a conversation with a specific meeting's own title/date/participants and asks the assistant to interview the caller about it, recording any action items via find_tasks/upsert_task scoped to that meeting.",
      argsSchema: {
        meetingId: z
          .string()
          .uuid()
          .describe('The meeting to gather information about'),
      },
    },
    async ({ meetingId }) => {
      const meeting = await meetingsRepository.findByIdAndOwner(
        meetingId,
        userId,
      );
      if (!meeting) {
        throw new Error(`Meeting ${meetingId} not found.`);
      }

      const participants =
        meeting.participants.length > 0
          ? meeting.participants.join(', ')
          : 'none recorded';

      return {
        description: `Gather information about "${meeting.title}"`,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `We're gathering information about the meeting "${meeting.title}", held on ${meeting.date.toISOString()}, with participants: ${participants} (meetingId: ${meetingId}). Ask me what was discussed, what decisions were made, and what action items came up. Before creating a task with upsert_task, call find_tasks first to check whether a similar one already exists for this meeting, and always scope both calls to meetingId "${meetingId}".`,
            },
          },
        ],
      };
    },
  );
}

/**
 * Verifies the `MCP_ACCESS_TOKEN` env var this process was spawned with (the same JWT
 * `/auth/login` issues, checked with the same `JwtService`/`JWT_SECRET` `JwtAuthGuard` uses) and
 * returns the signed-in user's id. Runs once at startup, before `server.connect` ever attaches the
 * transport, so an invalid or missing token means no `find_tasks` call is ever possible — there is
 * no per-call bearer token, this server's whole session speaks for whichever user's token it was
 * launched with (mirrors this app's existing `CLAUDE_CODE_OAUTH_TOKEN` convention for
 * authenticating a subprocess via an env var rather than a request header).
 */
async function resolveUserId(
  config: ConfigService,
  jwtService: JwtService,
): Promise<string> {
  const token = config.getOrThrow<string>('MCP_ACCESS_TOKEN');
  const payload = await jwtService.verifyAsync<JwtPayload>(token);
  return payload.sub;
}

/**
 * Entry point for the standalone task-manager MCP server (`find_tasks` + `upsert_task` tools, plus
 * a `gather_meeting_info` prompt): an MCP client spawns this file as a subprocess and talks to it
 * over stdio (`StdioServerTransport`), so `logger: false` here keeps Nest's own bootstrap logging
 * off stdout — that stream carries nothing but the MCP protocol once `server.connect` attaches the
 * transport.
 */
async function main() {
  const context = await NestFactory.createApplicationContext(
    FindTasksContextModule,
    { logger: false },
  );

  const userId = await resolveUserId(
    context.get(ConfigService),
    context.get(JwtService),
  );

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const taskService = context.get(TaskService);
  const meetingsRepository = context.get(MeetingsRepository);
  registerFindTasks(server, taskService, meetingsRepository, userId);
  registerUpsertTask(server, taskService, meetingsRepository, userId);
  registerGatherMeetingInfoPrompt(server, meetingsRepository, userId);

  await server.connect(new StdioServerTransport());

  const shutdown = () => {
    context
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start the find_tasks MCP server', error);
  process.exit(1);
});
