# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Rules and boundaries only. The per-file inventory is in `docs/architecture/api.md` and
`docs/testing/api.md` — read them when you need them, by plain path, never as an `@` import.

## Commands

From `apps/api/`, or `pnpm --filter api <script>` from the root: `pnpm dev` (watch) · `start` ·
`start:debug` · `start:prod` · `build` · `lint` · `test` (Jest units, `*.spec.ts` under `src`) ·
`test:watch` · `test:cov` · `test:e2e` (`*.e2e-spec.ts` under `test/`, needs
`docker compose up -d postgres`) · `prisma:generate` (after editing `prisma/schema.prisma`; also
runs on `pnpm install`) · `prisma:migrate`.

Run the narrowest scope — `pnpm test -- <name>.spec.ts`, `pnpm test -- -t "case"`,
`pnpm test:e2e -- auth.e2e-spec.ts`. The pre-commit hook runs the full suite, so don't pre-run it.

## Layout

`src/main.ts` bootstraps `AppModule` and restricts CORS to `WEB_URL`. `AppModule` imports
`ConfigModule` (global), `PrismaModule`, `StorageModule`, `UsersModule`, `AuthModule`,
`MeetingsModule`, and registers a global `ValidationPipe` (`whitelist`, `transform`).

- `src/prisma/` — `@Global()` `PrismaService`, the only `PrismaClient` in the app
- `src/storage/` — `@Global()` `StorageService` (local filesystem) and the shared Multer factory
- `src/users/` — user persistence, own-profile read/write, password change, avatar routes (upload, stream, delete);
  `GET /users/me`'s `ProfileResponse` reports `hasAvatar`/`avatarUpdatedAt`
- `src/auth/` — register/login, `TokenService`, `JwtAuthGuard`, `@CurrentUser()`
- `src/meetings/` — meetings and their recordings, many per meeting (upload, stream, delete)
- `src/transcription/` — `TranscriptionService`, transcribing a recording file via a local
  Whisper `base` model, run in the background after an upload (see Invariants)
- `src/meeting-summary/` — `MeetingSummaryService`, generating a per-meeting summary/action
  items/decisions via `ClaudeAgentService` once a recording's transcription reaches `READY`,
  run in the background the same way (see Invariants). Its `summarize` call gives the agent the
  `meeting` MCP tools (`../meeting-tools`) and only those (`tools: [], allowedTools:
MEETING_ALLOWED_TOOLS`), so it can look up/record `Task` rows and write the summary itself
  as it works, on top of the JSON reply `updateStatusIfCurrent` still persists — see Invariants.
- `src/tasks/` — `TaskService`, a standalone `Task` model tracking action items independently of
  `MeetingSummary.actionItems`'s JSON blob; `search`/`upsert` de-duplicate by title similarity
  (Postgres `pg_trgm`). Reached from `summarize`'s agent run via the `meeting` MCP tools.
- `src/claude-agent/` — `ClaudeAgentService`, a thin wrapper around the Claude Agent SDK for a
  single-turn prompt/response call; `ask` resolves a `ClaudeAgentReply` (`text` plus, when the
  caller set `options.outputFormat`, the schema-validated `structuredOutput`)
- `src/meeting-tools.ts` — `createMeetingToolsServer`, wrapping `TaskService`/`MeetingSummaryService`
  (via structural interfaces, not the concrete classes, to avoid a circular import with
  `meeting-summary/`) as a `meeting` SDK MCP server (`find_tasks`/`upsert_task`/`update_meeting`).
  Wired into `MeetingSummaryService.summarize`'s `options.mcpServers`.

## CQRS pattern

Every module that reads or mutates persisted state follows the `@nestjs/cqrs` convention `auth/`
established; new modules follow it rather than inventing one.

- **Commands** (`commands/<n>.command.ts` + `commands/handlers/<n>.handler.ts`) mutate state;
  **queries** (`queries/…`) are read-only even when they do real work — `LoginUserQuery` verifies a
  password hash and is still a query, because nothing is persisted.
- **Controllers stay thin**: `CommandBus`/`QueryBus` only, one `execute(new XCommand(...))` per
  route, never a repository or a handler. The sanctioned exception is a streaming response
  (`MeetingsController.getRecordingContent`), which also maps the result onto headers/status via
  `@Res({ passthrough: true })` — HTTP work a handler must not do.
- **Handlers hold the logic**: thin repositories (one per aggregate, near-1:1 over `PrismaService`)
  plus shared services, throwing Nest's HTTP exceptions directly. There is no mapping layer.
- **Cross-module communication goes through the bus, not direct imports.** A repository another
  module needs stays module-private and is reached by dispatching that module's command/query
  classes — `AuthModule` does not import `UsersModule`. Declare a repository directly in its own
  module only while nothing outside it touches that data.
- **DTOs vs commands**: `class-validator` lives in `dto/*.ts`; controllers map a validated DTO onto
  a command/query, which carries no validation of its own.

## Invariants

Rules no amount of reading the code makes obvious, each of which a change can break silently.
The reasoning behind them is in `docs/architecture/api.md`.

- **Any id that becomes a path must be a plain UUID** (`StorageService.assertValidId`) — the id
  arrives from a URL param or a JWT payload before any ownership check, and `..\..\Temp` would
  otherwise `path.join` outside `UPLOADS_DIR`.
- **`StorageService` stays HTTP-agnostic** — no `Express.Multer.File`, no route, no `Response`.
- **A foreign resource 404s, never 403s** — ownership must not leak through a status code.
- **Own-profile routes resolve the user from `@CurrentUser()`'s `sub`, never a route param.**
- **`BigInt` becomes a `string` at the response boundary** — `res.json()` throws on a raw one.
- **A row already gone returns `null`, not a throw**, so a lost race is a 404 rather than Prisma's
  `P2025` surfacing as a 500.
- **Delete the DB row before the file on disk**; **prune after the upsert commits**, from the real
  directory listing rather than a pre-upsert snapshot — that is what makes concurrent uploads to
  the same meeting or user race-free.
- **Upload limits live in env and are enforced by the Multer factory**, not by `StorageService`:
  `MAX_UPLOAD_SIZE_BYTES`/`ALLOWED_RECORDING_MIME_TYPES`, `MAX_AVATAR_SIZE_BYTES`/`ALLOWED_AVATAR_MIME_TYPES`.
  `assertKnown*MimeTypes` runs at bootstrap and throws if the allowlist names a MIME type the
  extension map does not know — otherwise it silently 415s every upload of that type.
- **`ALLOWED_RECORDING_MIME_TYPES` and `MAX_UPLOAD_SIZE_BYTES` must stay in sync with
  `ALLOWED_MIME_TYPES` and `MAX_SIZE_BYTES` in
  `apps/web/src/components/meetings/RecordingUploader.tsx`**, the client-side mirror of the same
  allowlist and cap. Change one, change the other, or the browser accepts a file the API rejects.
- **`@AllowQueryToken()` is opt-in per route.** The `?token=` fallback exists only because a
  `<video>`/`<audio>`/`<img>` `src` cannot set headers; blanket, it would let a token leaked through
  a recording or avatar URL authenticate the rest of the API.
- **Register and change-password hash with the shared `PASSWORD_SALT_ROUNDS`** (`auth/password-rules.ts`).
- **A `POST` that answers 200 needs `@HttpCode(HttpStatus.OK)`** — Nest defaults `POST` to 201.
- **Prisma 7 requires a driver adapter** (`@prisma/adapter-pg`); the connection string cannot live
  in `schema.prisma`. `PrismaService` reads `DATABASE_URL` via `ConfigService`, `prisma.config.ts`
  via `dotenv/config` for the CLI.
- **Transcription runs in the background, outside the upload request** — `UploadRecordingHandler`
  fires it without awaiting, driving `MeetingRecording.status` `UPLOADED` → `PROCESSING` →
  `READY`/`FAILED`. Every write from that background run goes through
  `RecordingsRepository.updateStatusIfCurrent`, matched on `recordingId` alone — sufficient because
  `RecordingsRepository.create` always gives a recording a fresh, permanent id (there is no
  upsert-in-place keeping an id stable across a replace, the way `storagePath` used to have to
  stand in for identity) — so a run started for a recording that has since been deleted becomes a
  no-op instead of clobbering a different row. The actual Whisper
  invocation is swapped behind the `WHISPER_RUNNER` DI token (`transcription/whisper-runner.ts`) so
  it can be stubbed in tests, unit and e2e alike, without a local Whisper install. Whisper's
  language is fixed to English (`transcription.module.ts`'s `WHISPER_LANGUAGE`) rather than left on
  auto-detection, which the `base` model gets wrong often enough on accented/noisy audio to
  mis-transcribe English speech as a different language entirely.
- **`@anthropic-ai/claude-agent-sdk` is ESM-only** — every dynamic `import()` of it (in
  `claude-agent.module.ts` and `meeting-tools.ts`) needs `node --experimental-vm-modules` under
  Jest's CommonJS test VM, on **every** script that can reach that code path, not just the unit
  `test` script — `test:e2e` runs it too (`MeetingSummaryService.summarize`, exercised by any e2e
  spec that uploads a recording), so it carries the same flag.
- **`update_meeting` (a `meeting-tools.ts` tool) always settles `MeetingSummary.status` to `READY`**
  — when the agent calls it mid-fold, on a meeting with more than one recording still
  transcribing, the row is briefly `READY` until `MeetingSummaryService.generateForMeeting`'s own
  trailing `updateStatusIfCurrent` call corrects it back to `PENDING` moments later. That write is
  still the authority on final status/content; `update_meeting`'s write is not required for
  correctness, only for letting the agent record what it found as it works.
- **`meeting-tools.ts`'s `upsert_task`/`update_meeting` take no meeting id in their input schema**
  — `createMeetingTools`/`createMeetingToolsServer` are given the target `meetingId` by
  `MeetingSummaryService.summarize` (its own trusted parameter) and close over it; the model never
  supplies it. This is deliberate, not an oversight: a tool argument the model fills in from the
  transcript is something a transcript can try to control, so a meeting id read that way could let
  a hostile transcript (prompt injection) redirect a write to a different meeting. Keep new tools
  in this file that write scoped-to-a-meeting data bound the same way — never add a meeting/task
  id back to `upsert_task`'s or `update_meeting`'s schema, even to make testing more convenient.
- **`TaskService.upsert`'s dedup lookup is scoped to `sourceMeetingId`, not just `upsert_task`'s
  schema** — closing over `meetingId` at the tool layer isn't enough by itself: without this,
  `upsert_task`'s title-similarity match could still find and _update_ a task belonging to a
  completely different meeting, purely from a title that happens to match — no meeting id involved
  at all, so binding one at the tool layer wouldn't have stopped it. `TaskRepository.search`'s
  optional `sourceMeetingId` param is what enforces this at the query level; `TaskService.search`
  (and `find_tasks`, which calls it) stays meeting-agnostic on purpose — it's read-only, so it can
  safely surface a similar task from elsewhere for awareness without any risk of mutating it. Never
  make `upsert`'s dedup search meeting-agnostic again, even to "let a recurring action item collapse
  across meetings" — that reintroduces the same cross-meeting write this bullet exists to prevent.
- **`MeetingSummaryService.summarize` retries on an invalid agent reply** — up to
  `MAX_SUMMARY_ATTEMPTS` (3) re-asks with the same prompt/options when `parseSummaryReply` rejects
  the reply, before letting the error propagate to `generateForMeeting`'s `FAILED`-marking catch.
  Safe to repeat: a retried attempt re-running `upsert_task`/`update_meeting` just re-applies the
  same meeting-scoped dedup/overwrite, not a duplicate write.
- **`summary-prompt.ts`'s user-turn prompt must never tell the model to answer with "only JSON,
  nothing else"** — an earlier version did, left over from before the `meeting` tools existed, and
  it silently made the model skip straight to a direct JSON answer without ever calling
  `find_tasks`/`upsert_task`/`update_meeting`, even though `MEETING_AGENT_SYSTEM_PROMPT` told it to
  use them — confirmed by comparing real tool-call traces with and without that line, same model,
  same transcript. `options.outputFormat` (the SDK's own structured-output mechanism) is what
  enforces the JSON shape on the final answer; the prompt doesn't need to ask for that too, and
  doing so actively suppresses tool use. If a future prompt tweak needs to emphasize the reply
  shape again, phrase it in terms of what to submit _after_ using the tools, never "just answer,
  nothing else."
- **`MeetingSummaryService.generateForMeeting` resumes folding instead of always refolding every
  ready recording from scratch** — `MeetingSummary.foldedRecordingIds` records which recordings (in
  order) are already reflected in the persisted result; `resumeFoldFrom` only falls back to a full
  refold when the new ready-recording-id list isn't an exact, in-order extension of that (a
  recording finished out of order, or the ready set shrank because one was deleted). Without this,
  every recording finishing transcription re-triggers a full refold of every ready recording so
  far — O(N²) real agent calls for N recordings finishing close together, since
  `SummaryReconciliationService` chains (never parallelizes) runs for the same meeting. Never make
  this always-refold again without also fixing the chaining, or reintroduce per-run refolding as a
  "simplification" — it's the main driver of end-to-end summary latency once a meeting has more
  than one or two recordings.

## Testing

Jest units are configured inline in `package.json` (`rootDir: "src"`, `*.spec.ts` colocated with
the code). E2e specs boot the real `AppModule` against the Postgres from `docker-compose.yml` and
truncate their tables in `beforeEach`. Two rules follow:

- **`test/jest-e2e.json` sets `"maxWorkers": 1`** — the specs share one real database, and in
  parallel one file's `deleteMany()` interleaves with another's in-flight test and throws spurious
  foreign-key errors. Do not raise it.
- **An e2e spec that writes files points `UPLOADS_DIR` at its own temp directory in `beforeAll`** —
  before anything compiles `AppModule`, since `dotenv` never overwrites an already-set var — and
  wipes it in `afterAll`. A size-limit case builds a one-off app with a tiny limit instead of
  mutating the shared one.

What each spec covers: `docs/testing/api.md`. ESLint is `typescript-eslint` recommendedTypeChecked
plus `eslint-plugin-prettier`; `no-explicit-any` is off,
`no-floating-promises`/`no-unsafe-argument` are warnings.

## Database

`prisma/schema.prisma` + `prisma/migrations/`: `User` → `users`, `Meeting` → `meetings`,
`MeetingRecording` → `meeting_recordings` (many per meeting, `status`/`transcriptText` tracking
each recording's own background transcription — see Invariants), `UserAvatar` → `user_avatars` (at
most one per user); every child FK is `onDelete: Cascade`.

Env vars (`apps/api/.env`, see `.env.example`): `DATABASE_URL` (must match the root
`docker-compose.yml` credentials), `JWT_SECRET`, `PORT` (default `3001` — **must differ from
`apps/web`'s 3000**, both run under `pnpm dev`), `WEB_URL` (default `http://localhost:3000`, the
CORS origin — **must match where `apps/web` is served**), `UPLOADS_DIR` (default `uploads`, relative
to `apps/api/`, gitignored, created on demand), plus the four upload-limit vars above,
`WHISPER_MODEL_DIR` (where the local Whisper `base` model is downloaded to/read from; unset lets
`nodejs-whisper` fall back to its own default location), and `CLAUDE_CODE_OAUTH_TOKEN` (required —
authenticates every `ClaudeAgentService` call; the SDK subprocess reads it straight from
`process.env`, see `claude-agent.module.ts`).

## Reference

- `docs/architecture/api.md` — every module, file, class and method
- `docs/testing/api.md` — what each unit and e2e spec covers
- `docs/meeting-recording-upload/research.md` — design notes behind the recording upload flow
- `apps/web/CLAUDE.md` — the frontend that calls this API
