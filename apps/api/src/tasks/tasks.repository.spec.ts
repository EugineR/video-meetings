import { Prisma, Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskRepository } from './tasks.repository';

describe('TaskRepository', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Draft the roadmap doc',
    sourceMeetingId: 'meeting-1',
    status: TaskStatus.OPEN,
    createdAt: new Date(),
  };

  let queryRaw: jest.Mock<Promise<Task[]>, [Prisma.Sql]>;
  let create: jest.Mock;
  let update: jest.Mock;
  let repository: TaskRepository;

  beforeEach(() => {
    queryRaw = jest.fn<Promise<Task[]>, [Prisma.Sql]>();
    create = jest.fn();
    update = jest.fn();

    const prisma = {
      $queryRaw: queryRaw,
      task: { create, update },
    } as unknown as PrismaService;

    repository = new TaskRepository(prisma);
  });

  describe('search', () => {
    it('runs a similarity query and returns the matches', async () => {
      queryRaw.mockResolvedValue([task]);

      const result = await repository.search('roadmap doc');

      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual([task]);
    });

    it('returns an empty array when nothing is similar enough', async () => {
      queryRaw.mockResolvedValue([]);

      const result = await repository.search('completely unrelated text');

      expect(result).toEqual([]);
    });

    it('does not filter by meeting when sourceMeetingId is omitted', async () => {
      queryRaw.mockResolvedValue([task]);

      await repository.search('roadmap doc');

      const sql = queryRaw.mock.calls[0][0];
      expect(sql.text).not.toContain('AND "sourceMeetingId"');
      expect(sql.values).toEqual(['roadmap doc', 0.3, 'roadmap doc', 10]);
    });

    it('filters matches to the given meeting when sourceMeetingId is provided', async () => {
      queryRaw.mockResolvedValue([task]);

      await repository.search('roadmap doc', 1, 'meeting-1');

      const sql = queryRaw.mock.calls[0][0];
      expect(sql.text).toContain('AND "sourceMeetingId"');
      expect(sql.values).toEqual([
        'roadmap doc',
        0.3,
        'meeting-1',
        'roadmap doc',
        1,
      ]);
    });
  });

  describe('create', () => {
    it('creates a task with the given data', async () => {
      create.mockResolvedValue(task);

      const result = await repository.create({
        title: task.title,
        sourceMeetingId: task.sourceMeetingId,
      });

      expect(create).toHaveBeenCalledWith({
        data: { title: task.title, sourceMeetingId: task.sourceMeetingId },
      });
      expect(result).toBe(task);
    });
  });

  describe('update', () => {
    it('updates the task by id', async () => {
      const updated = { ...task, status: TaskStatus.DONE };
      update.mockResolvedValue(updated);

      const result = await repository.update(task.id, {
        status: TaskStatus.DONE,
      });

      expect(update).toHaveBeenCalledWith({
        where: { id: task.id },
        data: { status: TaskStatus.DONE },
      });
      expect(result).toBe(updated);
    });
  });
});
