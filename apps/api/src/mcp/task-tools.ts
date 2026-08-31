import { Injectable } from '@nestjs/common';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { TaskService } from '../tasks/tasks.service';

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
 * The `find_tasks`/`upsert_task` MCP tools plus the `tasks://open`/`task://{id}` resources, as a
 * real NestJS provider injecting the app's own `TaskService` via DI — unlike `meeting-tools.ts`
 * (a plain module building Claude Agent SDK tools, no `@Injectable`) and `find-tasks-server.ts`
 * (a standalone process resolving `TaskService` from its own narrow
 * `NestFactory.createApplicationContext`), this one runs inside the main app's DI container and
 * is registered on `McpService`'s in-process `McpServer` by `McpModule` at startup. Every
 * handler below delegates straight to a `TaskService` method — no dedup/search/write logic is
 * reimplemented here, only translated into the MCP tool/resource call shape.
 *
 * `find_tasks`'s `meetingId` is optional, mirroring `TaskService.search`'s own optional
 * `sourceMeetingId` — omitted, it searches across every meeting's tasks, same as
 * `meeting-tools.ts`'s in-process `find_tasks`. `upsert_task`'s `meetingId` is required, mirroring
 * `TaskService.upsert`'s `UpsertTaskInput.sourceMeetingId`, which has no optional form: there is no
 * per-run meeting id to close over here the way `meeting-tools.ts` does (a Claude Agent SDK run
 * scoped to one meeting), so the caller supplies it explicitly instead, the same shape
 * `find-tasks-server.ts`'s standalone `upsert_task` uses.
 *
 * Like the rest of `McpModule`, none of this is authorization-gated yet (`apps/api/CLAUDE.md`'s
 * Invariants) — any caller reaching `/mcp` can search or write any meeting's tasks.
 */
@Injectable()
export class TaskTools {
  constructor(private readonly taskService: TaskService) {}

  registerOn(server: McpServer): void {
    this.registerFindTasks(server);
    this.registerUpsertTask(server);
    this.registerOpenTasksResource(server);
    this.registerTaskResource(server);
  }

  private registerFindTasks(server: McpServer): void {
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
              'Restrict the search to this meeting only; omitted, searches across every meeting',
            ),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ query, meetingId }) => {
        const matches = await this.taskService.search(query, meetingId);
        return textResult(matches);
      },
    );
  }

  private registerUpsertTask(server: McpServer): void {
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
        const task = await this.taskService.upsert({
          title,
          status,
          sourceMeetingId: meetingId,
        });
        return textResult(task);
      },
    );
  }

  private registerOpenTasksResource(server: McpServer): void {
    server.registerResource(
      'tasks-open',
      OPEN_TASKS_RESOURCE_URI,
      {
        description: 'Every task currently in OPEN status, across all meetings',
        mimeType: 'application/json',
      },
      async (uri) => {
        const tasks = await this.taskService.findOpenTasks();
        return jsonResource(uri.href, tasks);
      },
    );
  }

  private registerTaskResource(server: McpServer): void {
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
        const task = await this.taskService.findById(taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found.`);
        }
        return jsonResource(uri.href, task);
      },
    );
  }
}
