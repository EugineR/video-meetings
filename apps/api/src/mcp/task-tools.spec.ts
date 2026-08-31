import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { Task, TaskStatus } from '@prisma/client';
import { TaskService } from '../tasks/tasks.service';
import { TaskTools } from './task-tools';

interface ToolConfig {
  annotations?: { readOnlyHint?: boolean };
}
type ToolHandler = (
  args: Record<string, unknown>,
  extra: unknown,
) => Promise<CallToolResult>;

interface ResourceConfig {
  description?: string;
  mimeType?: string;
}
type ResourceHandler = (
  uri: URL,
  variablesOrExtra: unknown,
  maybeExtra?: unknown,
) => Promise<ReadResourceResult>;

describe('TaskTools', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Draft the roadmap doc',
    sourceMeetingId: 'meeting-1',
    status: TaskStatus.OPEN,
    createdAt: new Date(),
  };

  let search: jest.Mock;
  let upsert: jest.Mock;
  let findOpenTasks: jest.Mock;
  let findById: jest.Mock;
  let registerTool: jest.Mock<unknown, [string, ToolConfig, ToolHandler]>;
  let registerResource: jest.Mock<
    unknown,
    [string, unknown, ResourceConfig, ResourceHandler]
  >;

  beforeEach(() => {
    search = jest.fn();
    upsert = jest.fn();
    findOpenTasks = jest.fn();
    findById = jest.fn();
    registerTool = jest.fn<unknown, [string, ToolConfig, ToolHandler]>();
    registerResource = jest.fn<
      unknown,
      [string, unknown, ResourceConfig, ResourceHandler]
    >();

    const taskService = {
      search,
      upsert,
      findOpenTasks,
      findById,
    } as unknown as TaskService;

    const server = { registerTool, registerResource } as unknown as McpServer;

    const taskTools = new TaskTools(taskService);
    taskTools.registerOn(server);
  });

  function toolCall(name: string): {
    config: ToolConfig;
    handler: ToolHandler;
  } {
    const call = registerTool.mock.calls.find((c) => c[0] === name);
    if (!call) {
      throw new Error(`No tool registered with name ${name}`);
    }
    return { config: call[1], handler: call[2] };
  }

  function resourceCall(name: string): {
    uriOrTemplate: unknown;
    config: ResourceConfig;
    handler: ResourceHandler;
  } {
    const call = registerResource.mock.calls.find((c) => c[0] === name);
    if (!call) {
      throw new Error(`No resource registered with name ${name}`);
    }
    return { uriOrTemplate: call[1], config: call[2], handler: call[3] };
  }

  it('registers find_tasks, upsert_task and both resources', () => {
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(registerResource).toHaveBeenCalledTimes(2);
  });

  describe('find_tasks', () => {
    it('is marked read-only', () => {
      expect(toolCall('find_tasks').config.annotations).toEqual({
        readOnlyHint: true,
      });
    });

    it('delegates to TaskService.search, meeting-agnostic when meetingId is omitted', async () => {
      search.mockResolvedValue([task]);

      const result = await toolCall('find_tasks').handler(
        { query: 'roadmap doc' },
        undefined,
      );

      expect(search).toHaveBeenCalledWith('roadmap doc', undefined);
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify([task]) }],
      });
    });

    it('scopes the search to meetingId when given', async () => {
      search.mockResolvedValue([task]);

      await toolCall('find_tasks').handler(
        { query: 'roadmap doc', meetingId: 'meeting-1' },
        undefined,
      );

      expect(search).toHaveBeenCalledWith('roadmap doc', 'meeting-1');
    });
  });

  describe('upsert_task', () => {
    it('is marked mutating', () => {
      expect(toolCall('upsert_task').config.annotations).toEqual({
        readOnlyHint: false,
      });
    });

    it('delegates to TaskService.upsert with the given meetingId as sourceMeetingId', async () => {
      upsert.mockResolvedValue(task);

      const result = await toolCall('upsert_task').handler(
        { meetingId: 'meeting-1', title: 'Draft the roadmap doc' },
        undefined,
      );

      expect(upsert).toHaveBeenCalledWith({
        title: 'Draft the roadmap doc',
        status: undefined,
        sourceMeetingId: 'meeting-1',
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(task) }],
      });
    });
  });

  describe('tasks://open resource', () => {
    it('is registered at the tasks://open URI', () => {
      expect(resourceCall('tasks-open').uriOrTemplate).toBe('tasks://open');
    });

    it('delegates to TaskService.findOpenTasks and returns it as JSON', async () => {
      findOpenTasks.mockResolvedValue([task]);

      const result = await resourceCall('tasks-open').handler(
        new URL('tasks://open'),
        undefined,
      );

      expect(findOpenTasks).toHaveBeenCalledWith();
      expect(result).toEqual({
        contents: [
          {
            uri: 'tasks://open',
            mimeType: 'application/json',
            text: JSON.stringify([task]),
          },
        ],
      });
    });
  });

  describe('task://{id} resource', () => {
    it('is registered as a task://{id} template', () => {
      const template = resourceCall('task').uriOrTemplate as {
        uriTemplate: { toString(): string };
      };
      expect(template.uriTemplate.toString()).toBe('task://{id}');
    });

    it('delegates to TaskService.findById and returns it as JSON', async () => {
      findById.mockResolvedValue(task);

      const result = await resourceCall('task').handler(
        new URL('task://task-1'),
        { id: 'task-1' },
        undefined,
      );

      expect(findById).toHaveBeenCalledWith('task-1');
      expect(result).toEqual({
        contents: [
          {
            uri: 'task://task-1',
            mimeType: 'application/json',
            text: JSON.stringify(task),
          },
        ],
      });
    });

    it('throws when the task does not exist', async () => {
      findById.mockResolvedValue(null);

      await expect(
        resourceCall('task').handler(
          new URL('task://missing'),
          { id: 'missing' },
          undefined,
        ),
      ).rejects.toThrow('Task missing not found.');
    });
  });
});
