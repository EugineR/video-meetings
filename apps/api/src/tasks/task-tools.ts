import { Injectable, Logger } from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { McpRequester, McpToolRegistrar } from '../mcp/mcp-tool-registrar';
import { TaskService } from './tasks.service';

const OPEN_TASKS_RESOURCE_URI = 'tasks://open';
const TASK_RESOURCE_TEMPLATE = 'task://{id}';

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [
      { uri, mimeType: 'application/json', text: JSON.stringify(data) },
    ],
  };
}

/**
 * A single variable from a `ResourceTemplate`'s URI can come back as `string | string[]`
 * (a template can repeat a variable); `task://{id}` never does, so this always narrows to the one
 * string the client actually supplied.
 */
function firstValue(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The `tasks` domain's `McpToolRegistrar` (see `../mcp/mcp-tool-registrar.ts`): the
 * `find_tasks`/`upsert_task` MCP tools plus the `tasks://open`/`task://{id}` resources, as a real
 * NestJS provider injecting the app's own `TaskService` via DI — unlike `meeting-tools.ts` (a
 * plain module building Claude Agent SDK tools, no `@Injectable`) and the now-removed standalone
 * `find-tasks-server.ts` (which resolved `TaskService` from its own narrow
 * `NestFactory.createApplicationContext`), this one lives in `TasksModule` and runs inside the main
 * app's DI container. `TasksModule` exports it; `McpModule` imports `TasksModule` and folds it
 * into the `MCP_TOOL_REGISTRARS` token (see `mcp.module.ts`) rather than depending on this class
 * directly. Every handler below delegates straight to a `TaskService` method — no dedup/search/
 * write logic is reimplemented here, only translated into the MCP tool/resource call shape.
 *
 * `find_tasks`'s `meetingId` is optional, mirroring `TaskService.search`'s own optional
 * `sourceMeetingId` — omitted, it searches across every meeting the caller owns tasks in (never
 * another caller's, per the ownership scoping below), same shape `meeting-tools.ts`'s in-process
 * `find_tasks` uses (minus the ownership scoping, which that tool has no caller identity for).
 * `upsert_task`'s `meetingId` is required, mirroring `TaskService.upsert`'s
 * `UpsertTaskInput.sourceMeetingId`, which has no optional form: there is no per-run meeting id to
 * close over here the way `meeting-tools.ts` does (a Claude Agent SDK run scoped to one meeting), so
 * the caller supplies it explicitly instead.
 *
 * `registerOn`'s `requester` (the caller `McpAuthGuard` identified for this request — see
 * `../mcp/mcp-tool-registrar.ts`) is the authorization boundary for all four handlers below:
 * `find_tasks` and `tasks://open` only ever search/list `requester.userId`'s own tasks,
 * `upsert_task` always writes `ownerId: requester.userId` onto what it creates or matches — never a
 * value from its own arguments — and `task://{id}` loads by id first, then rejects with `Forbidden`
 * unless the loaded task's `ownerId` equals `requester.userId`. `meetingId` (`find_tasks`/
 * `upsert_task`'s own argument) narrows *what* to search for; `requester.userId` is what decides
 * *permission to see it* — the two are deliberately never the same check.
 */
@Injectable()
export class TaskTools implements McpToolRegistrar {
  private readonly logger = new Logger(TaskTools.name);

  constructor(private readonly taskService: TaskService) {}

  registerOn(server: McpServer, requester: McpRequester): void {
    this.registerFindTasks(server, requester);
    this.registerUpsertTask(server, requester);
    this.registerOpenTasksResource(server, requester);
    this.registerTaskResource(server, requester);
  }

  private registerFindTasks(server: McpServer, requester: McpRequester): void {
    server.registerTool(
      'find_tasks',
      {
        description:
          "Finds tasks whose title is textually similar to the given query, most similar match first. Use this before creating a task to check whether it already exists. Doesn't change any data.",
        inputSchema: {
          query: z
            .string()
            .min(1)
            .describe('Free text to match task titles against'),
          meetingId: z
            .string()
            .uuid()
            .optional()
            .describe(
              'Restrict the search to this meeting only; omitted, searches across every meeting. Either way, only your own tasks are returned.',
            ),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ query, meetingId }) => {
        this.logger.debug(`find_tasks called by requester ${requester.userId}`);
        const matches = await this.taskService.search(
          query,
          meetingId,
          requester.userId,
        );
        return textResult(matches);
      },
    );
  }

  private registerUpsertTask(server: McpServer, requester: McpRequester): void {
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
        this.logger.debug(
          `upsert_task called by requester ${requester.userId}`,
        );
        const task = await this.taskService.upsert({
          title,
          status,
          sourceMeetingId: meetingId,
          ownerId: requester.userId,
        });
        return textResult(task);
      },
    );
  }

  private registerOpenTasksResource(
    server: McpServer,
    requester: McpRequester,
  ): void {
    server.registerResource(
      'tasks-open',
      OPEN_TASKS_RESOURCE_URI,
      {
        description:
          'Every task you own that is currently in OPEN status, across all meetings',
        mimeType: 'application/json',
      },
      async (uri) => {
        this.logger.debug(`tasks://open read by requester ${requester.userId}`);
        const tasks = await this.taskService.findOpenTasks(requester.userId);
        return jsonResource(uri.href, tasks);
      },
    );
  }

  private registerTaskResource(
    server: McpServer,
    requester: McpRequester,
  ): void {
    const template = new ResourceTemplate(TASK_RESOURCE_TEMPLATE, {
      list: undefined,
    });
    server.registerResource(
      'task',
      template,
      {
        description: 'A single task by id',
        mimeType: 'application/json',
      },
      async (uri, { id }) => {
        const taskId = firstValue(id);
        this.logger.debug(
          `task://${taskId} read by requester ${requester.userId}`,
        );
        const task = await this.taskService.findById(taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found.`);
        }
        if (task.ownerId !== requester.userId) {
          throw new Error(
            `Forbidden (403): task ${taskId} does not belong to the caller.`,
          );
        }
        return jsonResource(uri.href, task);
      },
    );
  }
}
