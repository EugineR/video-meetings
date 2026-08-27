import { Injectable } from '@nestjs/common';
import { Prisma, Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Below this pg_trgm similarity score (0-1), two task titles are treated as unrelated rather than
 * the same recurring action item. Matches the trigram GIN index created alongside this table (see
 * the `add_task` migration) so `search` stays index-backed instead of a sequential scan.
 */
const MIN_TITLE_SIMILARITY = 0.3;

export interface CreateTaskInput {
  title: string;
  sourceMeetingId: string;
  status?: TaskStatus;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
}

@Injectable()
export class TaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tasks whose title is textually similar to `query`, most similar first, via Postgres `pg_trgm`
   * (`similarity()`). Requires the `pg_trgm` extension, enabled by the `add_task` migration.
   *
   * `sourceMeetingId`, when given, additionally restricts matches to that meeting — used by
   * `TaskService.upsert`'s dedup lookup, so it only ever updates a task that already belongs to the
   * meeting it's writing for (see `TaskService.upsert`'s own doc comment for why). Omitted for the
   * general-purpose lookup `TaskService.search` exposes, which is intentionally meeting-agnostic.
   */
  search(query: string, limit = 10, sourceMeetingId?: string): Promise<Task[]> {
    return this.prisma.$queryRaw<Task[]>(
      Prisma.sql`
        SELECT "id", "title", "sourceMeetingId", "status", "createdAt"
        FROM "tasks"
        WHERE similarity("title", ${query}) > ${MIN_TITLE_SIMILARITY}
        ${sourceMeetingId ? Prisma.sql`AND "sourceMeetingId" = ${sourceMeetingId}` : Prisma.empty}
        ORDER BY similarity("title", ${query}) DESC
        LIMIT ${limit}
      `,
    );
  }

  create(data: CreateTaskInput): Promise<Task> {
    return this.prisma.task.create({ data });
  }

  update(id: string, data: UpdateTaskInput): Promise<Task> {
    return this.prisma.task.update({ where: { id }, data });
  }
}
