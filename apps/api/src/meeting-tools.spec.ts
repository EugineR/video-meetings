import { Task, TaskStatus } from '@prisma/client';
import {
  createMeetingTools,
  MeetingSummaryWriter,
  TaskLookup,
} from './meeting-tools';

/**
 * `createMeetingTools` returns a union of differently-shaped `SdkMcpToolDefinition`s (one per
 * tool's own Zod schema) — calling `.handler` on the union member `Array.find` narrows to would
 * require args satisfying the intersection of all three tools' input shapes. Tests below call each
 * tool's handler with only that tool's own args, so they go through this loosely-typed view
 * instead.
 */
interface AnyMeetingTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  handler: (args: any, extra: unknown) => Promise<unknown>;
}

describe('createMeetingTools', () => {
  const meetingId = 'meeting-1';
  const ownerId = 'owner-1';
  const task: Task = {
    id: 'task-1',
    title: 'Draft the roadmap doc',
    sourceMeetingId: meetingId,
    ownerId: null,
    status: TaskStatus.OPEN,
    createdAt: new Date(),
  };

  let search: jest.Mock;
  let upsert: jest.Mock;
  let updateContent: jest.Mock;
  let tools: AnyMeetingTool[];

  beforeEach(async () => {
    search = jest.fn();
    upsert = jest.fn();
    updateContent = jest.fn();

    const taskService: TaskLookup = { search, upsert };
    const meetingSummaryService: MeetingSummaryWriter = { updateContent };

    tools = await createMeetingTools(
      meetingId,
      ownerId,
      taskService,
      meetingSummaryService,
    );
  });

  function toolByName(name: string) {
    const found = tools.find((t) => t.name === name);
    if (!found) {
      throw new Error(`No tool named ${name}`);
    }
    return found;
  }

  describe('find_tasks', () => {
    it('is marked read-only', () => {
      expect(toolByName('find_tasks').annotations).toEqual({
        readOnlyHint: true,
      });
    });

    it('delegates to TaskService.search and returns the matches as text', async () => {
      search.mockResolvedValue([task]);

      const result = await toolByName('find_tasks').handler(
        { query: 'roadmap doc' },
        undefined,
      );

      expect(search).toHaveBeenCalledWith('roadmap doc');
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify([task]) }],
      });
    });
  });

  describe('upsert_task', () => {
    it('does not accept a sourceMeetingId or ownerId in its input schema — always uses the meetingId/ownerId this tool set was created for', async () => {
      upsert.mockResolvedValue(task);

      const result = await toolByName('upsert_task').handler(
        {
          title: 'Draft the roadmap doc',
          status: TaskStatus.DONE,
          sourceMeetingId: 'a-different-meeting',
          ownerId: 'a-different-owner',
        },
        undefined,
      );

      expect(upsert).toHaveBeenCalledWith({
        title: 'Draft the roadmap doc',
        status: TaskStatus.DONE,
        sourceMeetingId: meetingId,
        ownerId,
      });
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(task) }],
      });
    });
  });

  describe('update_meeting', () => {
    it('does not accept a meetingId in its input schema — always writes to the meetingId this tool set was created for', async () => {
      const summary = {
        id: 'summary-1',
        meetingId,
        summaryText: 'The team agreed on the roadmap.',
        decisions: ['Ship in September'],
      };
      updateContent.mockResolvedValue(summary);

      const result = await toolByName('update_meeting').handler(
        {
          summary: 'The team agreed on the roadmap.',
          decisions: ['Ship in September'],
          meetingId: 'a-different-meeting',
        },
        undefined,
      );

      expect(updateContent).toHaveBeenCalledWith(
        meetingId,
        'The team agreed on the roadmap.',
        ['Ship in September'],
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(summary) }],
      });
    });

    it('returns an error result when the meeting no longer exists', async () => {
      updateContent.mockResolvedValue(null);

      const result = await toolByName('update_meeting').handler(
        { summary: 'Summary', decisions: [] },
        undefined,
      );

      expect(result).toEqual({
        content: [
          { type: 'text', text: `Meeting ${meetingId} does not exist.` },
        ],
        isError: true,
      });
    });
  });
});
