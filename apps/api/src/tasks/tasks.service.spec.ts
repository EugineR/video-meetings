import { Task, TaskStatus } from '@prisma/client';
import { TaskRepository } from './tasks.repository';
import { TaskService } from './tasks.service';

/** Lets a pending `.then`/`.catch` chain (any number of hops) settle before assertions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('TaskService', () => {
  const existingTask: Task = {
    id: 'task-1',
    title: 'Draft the roadmap doc',
    sourceMeetingId: 'meeting-1',
    status: TaskStatus.OPEN,
    createdAt: new Date(),
  };

  let search: jest.Mock;
  let create: jest.Mock;
  let update: jest.Mock;
  let findByStatus: jest.Mock;
  let findById: jest.Mock;
  let service: TaskService;

  beforeEach(() => {
    search = jest.fn();
    create = jest.fn();
    update = jest.fn();
    findByStatus = jest.fn();
    findById = jest.fn();

    const repository = {
      search,
      create,
      update,
      findByStatus,
      findById,
    } as unknown as TaskRepository;

    service = new TaskService(repository);
  });

  describe('search', () => {
    it('delegates to the repository, meeting-agnostic by default', async () => {
      search.mockResolvedValue([existingTask]);

      const result = await service.search('roadmap doc');

      expect(search).toHaveBeenCalledWith('roadmap doc', undefined, undefined);
      expect(result).toEqual([existingTask]);
    });

    it('scopes the search to sourceMeetingId when given', async () => {
      search.mockResolvedValue([existingTask]);

      const result = await service.search('roadmap doc', 'meeting-1');

      expect(search).toHaveBeenCalledWith(
        'roadmap doc',
        undefined,
        'meeting-1',
      );
      expect(result).toEqual([existingTask]);
    });
  });

  describe('upsert', () => {
    it('creates a new task when no similar task exists for the same meeting', async () => {
      search.mockResolvedValue([]);
      create.mockResolvedValue(existingTask);

      const result = await service.upsert({
        title: 'Draft the roadmap doc',
        sourceMeetingId: 'meeting-1',
      });

      expect(search).toHaveBeenCalledWith(
        'Draft the roadmap doc',
        1,
        'meeting-1',
      );
      expect(create).toHaveBeenCalledWith({
        title: 'Draft the roadmap doc',
        sourceMeetingId: 'meeting-1',
      });
      expect(update).not.toHaveBeenCalled();
      expect(result).toBe(existingTask);
    });

    it('updates the best-matching existing task for the same meeting instead of creating a duplicate', async () => {
      search.mockResolvedValue([existingTask]);
      const updatedTask = { ...existingTask, status: TaskStatus.DONE };
      update.mockResolvedValue(updatedTask);

      const result = await service.upsert({
        title: 'Draft the roadmap document',
        sourceMeetingId: existingTask.sourceMeetingId,
        status: TaskStatus.DONE,
      });

      expect(search).toHaveBeenCalledWith(
        'Draft the roadmap document',
        1,
        existingTask.sourceMeetingId,
      );
      expect(update).toHaveBeenCalledWith(existingTask.id, {
        title: 'Draft the roadmap document',
        status: TaskStatus.DONE,
      });
      expect(create).not.toHaveBeenCalled();
      expect(result).toBe(updatedTask);
    });

    it('leaves the existing status untouched when no status is given', async () => {
      search.mockResolvedValue([existingTask]);
      update.mockResolvedValue(existingTask);

      await service.upsert({
        title: 'Draft the roadmap doc',
        sourceMeetingId: existingTask.sourceMeetingId,
      });

      expect(update).toHaveBeenCalledWith(existingTask.id, {
        title: 'Draft the roadmap doc',
        status: undefined,
      });
    });

    it('scopes the dedup search to sourceMeetingId, so a similarly-titled task from a different meeting never gets matched/mutated', async () => {
      // The repository itself enforces this filter (see tasks.repository.spec.ts); this test
      // asserts TaskService actually passes the meeting id through rather than dropping it.
      search.mockResolvedValue([]);
      create.mockResolvedValue({
        ...existingTask,
        sourceMeetingId: 'meeting-2',
      });

      await service.upsert({
        title: 'Draft the roadmap doc',
        sourceMeetingId: 'meeting-2',
      });

      expect(search).toHaveBeenCalledWith(
        'Draft the roadmap doc',
        1,
        'meeting-2',
      );
      expect(create).toHaveBeenCalledWith({
        title: 'Draft the roadmap doc',
        sourceMeetingId: 'meeting-2',
      });
      expect(update).not.toHaveBeenCalled();
    });

    it('serializes concurrent upserts for the same meeting so a later one always searches after the earlier one writes', async () => {
      let resolveFirstSearch!: (tasks: Task[]) => void;
      search.mockImplementationOnce(
        () =>
          new Promise<Task[]>((resolve) => {
            resolveFirstSearch = resolve;
          }),
      );
      search.mockResolvedValueOnce([existingTask]);
      create.mockResolvedValue(existingTask);
      const updatedTask = { ...existingTask, status: TaskStatus.DONE };
      update.mockResolvedValue(updatedTask);

      const firstUpsert = service.upsert({
        title: 'Draft the roadmap doc',
        sourceMeetingId: 'meeting-1',
      });
      const secondUpsert = service.upsert({
        title: 'Draft roadmap document',
        sourceMeetingId: 'meeting-1',
      });

      await flushMicrotasks();
      // The second upsert's search must not have started yet — it's queued behind the first, which
      // hasn't resolved. Without the per-meeting queue, both would search concurrently, each seeing
      // no match, and both would create a duplicate task.
      expect(search).toHaveBeenCalledTimes(1);

      resolveFirstSearch([]);
      await firstUpsert;
      await secondUpsert;

      expect(search).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('does not serialize upserts for different meetings against each other', async () => {
      let resolveFirstSearch!: (tasks: Task[]) => void;
      search.mockImplementationOnce(
        () =>
          new Promise<Task[]>((resolve) => {
            resolveFirstSearch = resolve;
          }),
      );
      search.mockResolvedValueOnce([]);
      create.mockResolvedValue(existingTask);

      const firstUpsert = service.upsert({
        title: 'Task for meeting 1',
        sourceMeetingId: 'meeting-1',
      });
      const secondUpsert = service.upsert({
        title: 'Task for meeting 2',
        sourceMeetingId: 'meeting-2',
      });

      await flushMicrotasks();
      expect(search).toHaveBeenCalledTimes(2);

      resolveFirstSearch([]);
      await firstUpsert;
      await secondUpsert;
    });
  });

  describe('findOpenTasks', () => {
    it('delegates to the repository, scoped to OPEN status', async () => {
      findByStatus.mockResolvedValue([existingTask]);

      const result = await service.findOpenTasks();

      expect(findByStatus).toHaveBeenCalledWith(TaskStatus.OPEN);
      expect(result).toEqual([existingTask]);
    });
  });

  describe('findById', () => {
    it('delegates to the repository', async () => {
      findById.mockResolvedValue(existingTask);

      const result = await service.findById(existingTask.id);

      expect(findById).toHaveBeenCalledWith(existingTask.id);
      expect(result).toBe(existingTask);
    });

    it('returns null when the repository finds nothing', async () => {
      findById.mockResolvedValue(null);

      const result = await service.findById('missing');

      expect(result).toBeNull();
    });
  });
});
