import { Injectable } from '@nestjs/common';
import { Task, TaskStatus } from '@prisma/client';
import { TaskRepository } from './tasks.repository';

export interface UpsertTaskInput {
  title: string;
  sourceMeetingId: string;
  status?: TaskStatus;
}

@Injectable()
export class TaskService {
  constructor(private readonly tasksRepository: TaskRepository) {}

  /** Tasks whose title is textually similar to `query`, most similar first. */
  search(query: string): Promise<Task[]> {
    return this.tasksRepository.search(query);
  }

  /**
   * Creates a new `Task` for `input.title`, unless a task with a sufficiently similar title
   * already exists **for the same `input.sourceMeetingId`**, in which case that existing task's
   * title/status are updated and returned instead — so the same action item mentioned more than
   * once for one meeting (e.g. across its own multiple recordings) collapses onto one row rather
   * than piling up as duplicates. `input.status` is left unset on a fresh create (the schema
   * defaults it to `OPEN`), and left as-is on an update when not given.
   *
   * The dedup lookup is deliberately scoped to `input.sourceMeetingId` (unlike `search`, which is
   * meeting-agnostic) — this is a caller-facing entry point used by an LLM agent tool
   * (`meeting-tools.ts`'s `upsert_task`), and a title alone is attacker-influenceable content (the
   * meeting's transcript). Matching across meetings here would let a crafted/coincidental title in
   * one meeting silently rewrite another meeting's task, with no meeting id involved at all — a
   * caller only ever needs `search` (read-only) to notice a similar task exists elsewhere; `upsert`
   * must never mutate a row it doesn't own.
   */
  async upsert(input: UpsertTaskInput): Promise<Task> {
    const [bestMatch] = await this.tasksRepository.search(
      input.title,
      1,
      input.sourceMeetingId,
    );
    if (bestMatch) {
      return this.tasksRepository.update(bestMatch.id, {
        title: input.title,
        status: input.status,
      });
    }
    return this.tasksRepository.create(input);
  }
}
