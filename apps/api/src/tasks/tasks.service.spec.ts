import { Task, TaskStatus } from '@prisma/client';
import { TaskRepository } from './tasks.repository';
import { TaskService } from './tasks.service';

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
  let service: TaskService;

  beforeEach(() => {
    search = jest.fn();
    create = jest.fn();
    update = jest.fn();

    const repository = {
      search,
      create,
      update,
    } as unknown as TaskRepository;

    service = new TaskService(repository);
  });

  describe('search', () => {
    it('delegates to the repository', async () => {
      search.mockResolvedValue([existingTask]);

      const result = await service.search('roadmap doc');

      expect(search).toHaveBeenCalledWith('roadmap doc');
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
  });
});
