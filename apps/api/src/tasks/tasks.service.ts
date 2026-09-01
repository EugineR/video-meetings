import { Injectable } from '@nestjs/common';
import { Task, TaskStatus } from '@prisma/client';
import { TaskRepository } from './tasks.repository';

export interface UpsertTaskInput {
  title: string;
  sourceMeetingId: string;
  status?: TaskStatus;
  ownerId?: string;
}

@Injectable()
export class TaskService {
  /**
   * Chains `upsert` calls per `sourceMeetingId` so a search-then-write for one meeting never
   * overlaps another in-flight one for the same meeting — see `upsert`'s own doc comment for why.
   * Mirrors `SummaryReconciliationService.reconcile`'s per-`meetingId` chaining, except each queued
   * call's result (or rejection) is returned to its own caller rather than swallowed, since
   * `upsert_task` (`meeting-tools.ts`) needs the created/updated `Task` back.
   */
  private readonly upsertQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly tasksRepository: TaskRepository) {}

  /**
   * Tasks whose title is textually similar to `query`, most similar first.
   *
   * `sourceMeetingId`, when given, restricts matches to that one meeting's own tasks. `ownerId`,
   * when given, additionally restricts matches to that owner's own tasks — `task-tools.ts`'s
   * `find_tasks` (the `/mcp` HTTP endpoint) always passes the caller's `McpRequester.userId` here,
   * so a caller can only ever find their own tasks; the meeting id in its arguments narrows *what*
   * to search, never *permission to see* — that's `ownerId`'s job. Left unset, `search` stays both
   * meeting- and owner-agnostic, which is what `meeting-tools.ts`'s in-process `find_tasks`
   * deliberately relies on (see its own doc comment for why) — that tool has no authenticated caller
   * to scope by.
   */
  search(
    query: string,
    sourceMeetingId?: string,
    ownerId?: string,
  ): Promise<Task[]> {
    return this.tasksRepository.search(
      query,
      undefined,
      sourceMeetingId,
      ownerId,
    );
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
   * must never mutate a row it doesn't own. `input.ownerId`, when given, additionally scopes the
   * dedup lookup — `task-tools.ts`'s `upsert_task` (`/mcp`) always sets it from the caller's
   * `McpRequester.userId`, never from a tool argument, so a title collision alone can never let one
   * caller's write match and silently overwrite a different caller's task, same reasoning as the
   * meeting scoping above. Also written onto a freshly created row (`create`, below) — never onto an
   * update, since an update only ever matches a row the dedup lookup already confirmed has the same
   * `ownerId`. `meeting-tools.ts`'s in-process `upsert_task` never sets it (no authenticated caller
   * to attribute a task to), leaving those tasks' `ownerId` `null`.
   *
   * Chained per `sourceMeetingId` via `upsertQueues` rather than run directly: the Claude Agent SDK
   * can dispatch several tool calls from one model turn concurrently (its own docs: "PostToolUse
   * fires per-tool and may run concurrently for parallel tool calls"), and this search-then-write
   * isn't atomic — two concurrent `upsert` calls for near-duplicate titles in the same meeting could
   * both run `search` before either `create` commits, both find no match, and both create a
   * duplicate `Task`. Chaining serializes every `upsert` for a given meeting so each one's `search`
   * always sees the previous one's write.
   */
  async upsert(input: UpsertTaskInput): Promise<Task> {
    const previous =
      this.upsertQueues.get(input.sourceMeetingId) ?? Promise.resolve();
    const thisUpsert = previous
      .catch(() => undefined)
      .then(() => this.doUpsert(input));
    this.upsertQueues.set(input.sourceMeetingId, thisUpsert);
    thisUpsert
      .catch(() => undefined)
      .finally(() => {
        if (this.upsertQueues.get(input.sourceMeetingId) === thisUpsert) {
          this.upsertQueues.delete(input.sourceMeetingId);
        }
      });
    return thisUpsert;
  }

  /**
   * Every `OPEN` task, most recently created first — backs the `tasks://open` MCP resource.
   * `ownerId`, when given, restricts this to that owner's own tasks — `task-tools.ts` always passes
   * the caller's `McpRequester.userId` here.
   */
  findOpenTasks(ownerId?: string): Promise<Task[]> {
    return this.tasksRepository.findByStatus(TaskStatus.OPEN, ownerId);
  }

  /**
   * A single task by id, or `null` if it doesn't exist — backs the `task://{id}` MCP resource.
   * Unscoped by owner: `task-tools.ts` checks the returned task's `ownerId` against the caller
   * itself rather than folding that into this query, so a foreign task and a missing one stay
   * distinguishable at the call site (see its own doc comment).
   */
  findById(id: string): Promise<Task | null> {
    return this.tasksRepository.findById(id);
  }

  private async doUpsert(input: UpsertTaskInput): Promise<Task> {
    const [bestMatch] = await this.tasksRepository.search(
      input.title,
      1,
      input.sourceMeetingId,
      input.ownerId,
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
