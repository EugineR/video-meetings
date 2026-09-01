import { Prisma, Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TaskRepository } from './tasks.repository';

describe('TaskRepository', () => {
  const task: Task = {
    id: 'task-1',
    title: 'Draft the roadmap doc',
    sourceMeetingId: 'meeting-1',
    ownerId: 'owner-1',
    status: TaskStatus.OPEN,
    createdAt: new Date(),
  };

  let queryRaw: jest.Mock<Promise<Task[]>, [Prisma.Sql]>;
  let create: jest.Mock;
  let update: jest.Mock;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let repository: TaskRepository;

  beforeEach(() => {
    queryRaw = jest.fn<Promise<Task[]>, [Prisma.Sql]>();
    create = jest.fn();
    update = jest.fn();
    findMany = jest.fn();
    findUnique = jest.fn();

    const prisma = {
      $queryRaw: queryRaw,
      task: { create, update, findMany, findUnique },
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
      expect(sql.text).not.toContain('WHERE "sourceMeetingId"');
      expect(sql.values).toEqual(['roadmap doc', 0.3, 10]);
    });

    it('filters matches to the given meeting when sourceMeetingId is provided', async () => {
      queryRaw.mockResolvedValue([task]);

      await repository.search('roadmap doc', 1, 'meeting-1');

      const sql = queryRaw.mock.calls[0][0];
      expect(sql.text).toContain('WHERE "sourceMeetingId"');
      expect(sql.values).toEqual(['roadmap doc', 'meeting-1', 0.3, 1]);
    });

    it('filters matches to the given owner when ownerId is provided', async () => {
      queryRaw.mockResolvedValue([task]);

      await repository.search('roadmap doc', 1, undefined, 'owner-1');

      const sql = queryRaw.mock.calls[0][0];
      expect(sql.text).toContain('WHERE "ownerId"');
      expect(sql.values).toEqual(['roadmap doc', 'owner-1', 0.3, 1]);
    });

    it('combines sourceMeetingId and ownerId with AND when both are provided', async () => {
      queryRaw.mockResolvedValue([task]);

      await repository.search('roadmap doc', 1, 'meeting-1', 'owner-1');

      const sql = queryRaw.mock.calls[0][0];
      expect(sql.text).toContain('"sourceMeetingId" = $2 AND "ownerId" = $3');
      expect(sql.values).toEqual([
        'roadmap doc',
        'meeting-1',
        'owner-1',
        0.3,
        1,
      ]);
    });

    it('computes the title-similarity expression only once per row, using word_similarity', async () => {
      queryRaw.mockResolvedValue([task]);

      await repository.search('roadmap doc');

      const sql = queryRaw.mock.calls[0][0];
      expect(sql.text.match(/word_similarity\(/g)?.length).toBe(1);
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

  describe('findByStatus', () => {
    it('lists tasks with the given status, most recently created first', async () => {
      findMany.mockResolvedValue([task]);

      const result = await repository.findByStatus(TaskStatus.OPEN);

      expect(findMany).toHaveBeenCalledWith({
        where: { status: TaskStatus.OPEN },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([task]);
    });

    it('filters to the given owner when ownerId is provided', async () => {
      findMany.mockResolvedValue([task]);

      await repository.findByStatus(TaskStatus.OPEN, 'owner-1');

      expect(findMany).toHaveBeenCalledWith({
        where: { status: TaskStatus.OPEN, ownerId: 'owner-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findById', () => {
    it('returns the task with the given id', async () => {
      findUnique.mockResolvedValue(task);

      const result = await repository.findById(task.id);

      expect(findUnique).toHaveBeenCalledWith({ where: { id: task.id } });
      expect(result).toBe(task);
    });

    it('returns null when no task has that id', async () => {
      findUnique.mockResolvedValue(null);

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });
  });
});
