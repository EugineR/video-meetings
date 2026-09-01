import { Injectable } from '@nestjs/common';
import { Prisma, Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Below this pg_trgm word-similarity score (0-1), a query is treated as unrelated to a task title
 * rather than a match (a duplicate title, or a search term drawn from it). Matches the trigram GIN
 * index created alongside this table (see the `add_task` migration) so `search` stays index-backed
 * instead of a sequential scan.
 */
const MIN_TITLE_SIMILARITY = 0.3;

export interface CreateTaskInput {
  title: string;
  sourceMeetingId: string;
  status?: TaskStatus;
  ownerId?: string;
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
   * (`word_similarity(query, title)`, not plain `similarity()`). `similarity()` normalizes over the
   * combined trigram set of *both* strings, so a short `query` (a keyword or two) against a much
   * longer `title` scores low even on a perfect substring match — e.g. `similarity('review',
   * 'Review PR from Lesson Dennis')` is 0.24, under `MIN_TITLE_SIMILARITY`, even though `review` is
   * right there in the title. `word_similarity(query, title)` instead scores the best-matching
   * word-aligned extent of `title` against the whole of `query` — the same case scores 1.0 — so it
   * suits both this method's actual callers: a short free-text query typed by a human/agent via
   * `/mcp` (`task-tools.ts`'s `find_tasks`), and `TaskService.upsert`'s dedup check, which passes a
   * full candidate title (comparable in length to `title`, where `word_similarity` performs at
   * least as well as `similarity` did). Argument order matters: `word_similarity(a, b)` measures how
   * well `a` matches *within* `b`, not the reverse. Requires the `pg_trgm` extension, enabled by the
   * `add_task` migration.
   *
   * `sourceMeetingId`, when given, additionally restricts matches to that meeting — used by
   * `TaskService.upsert`'s dedup lookup, so it only ever updates a task that already belongs to the
   * meeting it's writing for (see `TaskService.upsert`'s own doc comment for why). Omitted for the
   * general-purpose lookup `TaskService.search` exposes, which is intentionally meeting-agnostic.
   *
   * `ownerId`, when given, additionally restricts matches to that owner's own tasks — used by
   * `/mcp`'s `find_tasks`/`upsert_task` (via `TaskService`), never by `meeting-tools.ts`'s in-process
   * `find_tasks` (see `TaskService.search`'s own doc comment for why it stays unscoped there).
   */
  search(
    query: string,
    limit = 10,
    sourceMeetingId?: string,
    ownerId?: string,
  ): Promise<Task[]> {
    const conditions: Prisma.Sql[] = [];
    if (sourceMeetingId) {
      conditions.push(Prisma.sql`"sourceMeetingId" = ${sourceMeetingId}`);
    }
    if (ownerId) {
      conditions.push(Prisma.sql`"ownerId" = ${ownerId}`);
    }
    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    return this.prisma.$queryRaw<Task[]>(
      Prisma.sql`
        SELECT "id", "title", "sourceMeetingId", "ownerId", "status", "createdAt"
        FROM (
          SELECT "id", "title", "sourceMeetingId", "ownerId", "status", "createdAt",
                 word_similarity(${query}, "title") AS "titleSimilarity"
          FROM "tasks"
          ${whereClause}
        ) "scored"
        WHERE "titleSimilarity" > ${MIN_TITLE_SIMILARITY}
        ORDER BY "titleSimilarity" DESC
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

  /**
   * All tasks with the given `status`, most recently created first. `ownerId`, when given,
   * restricts this to that owner's own tasks — used by `/mcp`'s `tasks://open` resource.
   */
  findByStatus(status: TaskStatus, ownerId?: string): Promise<Task[]> {
    return this.prisma.task.findMany({
      where: { status, ...(ownerId ? { ownerId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<Task | null> {
    return this.prisma.task.findUnique({ where: { id } });
  }
}
