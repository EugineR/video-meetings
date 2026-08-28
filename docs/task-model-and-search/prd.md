# PRD: Task Model and TaskService

**Date**: 2026-08-27
**Status**: Draft

## Goal

Action items are currently stored as an untyped JSON blob on `MeetingSummary.actionItems`, which
makes it impossible to track a task's own lifecycle or find out whether a similar task already
exists from an earlier meeting. Introduce a dedicated `Task` model plus a `TaskService` so action
items become first-class, queryable, and de-duplicable records, independent of how a summary
happens to have described them.

## Scenario

- Meeting summary generation produces an action item for a meeting -> the system calls
  `TaskService.upsert(...)`, which creates a new `Task` row, or updates an existing one when a
  near-duplicate task (by title similarity) already exists, so the same recurring action item
  doesn't pile up as separate rows across meetings.
- A caller (e.g. a future task-list view or the summary pipeline) calls `TaskService.search(query)`
  with free text -> it receives the `Task` rows whose `title` is textually similar to `query`,
  ranked by similarity, so near-duplicate or previously-seen tasks can be surfaced.

## In scope

- A new `Task` Prisma model: `id` (uuid, PK), `title` (string), `sourceMeetingId` (FK to
  `Meeting`, `onDelete: Cascade`), `status` (enum: `OPEN`, `IN_PROGRESS`, `DONE`; default `OPEN`),
  `createdAt` (default `now()`).
- A Postgres migration that creates the `Task` table/enum and enables the `pg_trgm` extension
  (required for trigram-based similarity search).
- A trigram (GIN) index on `Task.title` so similarity search doesn't sequentially scan the table.
- `TaskService` (NestJS injectable, backed by a Prisma-based repository per the module's CQRS
  convention) with two methods:
  - `search(query: string): Promise<Task[]>` — returns tasks whose `title` is similar to `query`
    using Postgres `pg_trgm` similarity (`similarity()` / the `%` operator), ordered by similarity
    descending, above a minimum similarity threshold.
  - `upsert(input: { title: string; sourceMeetingId: string; status?: TaskStatus }): Promise<Task>`
    — looks up the best `search` match for `input.title`; if it clears a match threshold, updates
    that existing `Task` (title/status) and returns it; otherwise creates a new `Task` row.
- A `tasks` NestJS module wiring `TaskService`/repository into `AppModule`, following this repo's
  CQRS convention (thin repository, command/query classes + handlers, `TaskService` as the
  injectable facade other modules depend on).
- Unit tests for `TaskService.search` and `TaskService.upsert` (match found vs. no match), and a
  migration that applies cleanly via `prisma migrate dev`.

## Out of scope

- Any assignee/owner field on `Task` — there is no concept of a responsible user yet.
- Wiring `MeetingSummaryService`'s existing `actionItems` JSON generation to call
  `TaskService.upsert` for each parsed action item, or removing `MeetingSummary.actionItems` —
  this PRD only introduces the model and service; integrating the summary pipeline with it is a
  follow-up.
- Any HTTP endpoint/controller exposing `Task` data to the frontend.
- Any frontend UI for viewing, searching, or updating tasks.
- Task editing/deletion beyond what `upsert` does (no standalone update/delete method).
- Due dates, priorities, tags, or any other task metadata beyond `title`/`status`.
- Configurable or per-call similarity thresholds — a single threshold constant is fixed in code.

## Technical constraints

- Must use Prisma 7 with the existing `@prisma/adapter-pg` driver adapter setup (`prisma.config.ts`,
  `DATABASE_URL` via `ConfigService`); the migration must not put a connection string in
  `schema.prisma`.
- Similarity search depends on the Postgres `pg_trgm` extension, enabled via
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the generated migration — this must run before the
  trigram index is created in the same migration.
- `sourceMeetingId` is a required FK to `Meeting` with `onDelete: Cascade`, matching how every
  other child table in this schema (`MeetingRecording`, `MeetingSummary`) cascades from `Meeting`.
- Follows this repo's established CQRS module convention (`apps/api/CLAUDE.md`): a thin repository
  near-1:1 over `PrismaService`, command/query classes with handlers holding the logic, and
  `TaskService` as the facade other modules call instead of reaching into the repository directly.
- `pnpm --filter api prisma:generate` must be run after the schema change, and the migration must
  be generated via `pnpm --filter api prisma:migrate` so it's tracked under
  `apps/api/prisma/migrations/`.

## Acceptance criteria

- [ ] `Task` model exists in `schema.prisma` with `id`, `title`, `sourceMeetingId`, `status`
      (`TaskStatus` enum: `OPEN`/`IN_PROGRESS`/`DONE`, default `OPEN`), `createdAt`, and a
      `Meeting` relation with `onDelete: Cascade`.
- [ ] A migration exists under `apps/api/prisma/migrations/` that enables `pg_trgm`, creates the
      `tasks` table and `TaskStatus` enum, and adds a trigram index on `title`; it applies cleanly
      against a fresh database.
- [ ] `TaskService.search(query)` returns tasks ordered by title similarity to `query`, excluding
      tasks below the similarity threshold, and returns an empty array when nothing matches.
- [ ] `TaskService.upsert(...)` creates a new `Task` when no sufficiently similar task exists, and
      updates the best-matching existing `Task` (rather than creating a duplicate) when one does.
- [ ] `TaskService` has no field, parameter, or method related to an assignee/owner.
- [ ] Unit tests cover both branches of `upsert` (create vs. update) and `search`'s
      match/no-match cases.
- [ ] `apps/api/CLAUDE.md`'s Database section is updated to list the `Task`/`tasks` table alongside
      the existing models.
