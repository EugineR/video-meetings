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
to `apps/api/`, gitignored, created on demand), plus the four upload-limit vars above and
`WHISPER_MODEL_DIR` (where the local Whisper `base` model is downloaded to/read from; unset lets
`nodejs-whisper` fall back to its own default location).

## Reference

- `docs/architecture/api.md` — every module, file, class and method
- `docs/testing/api.md` — what each unit and e2e spec covers
- `docs/meeting-recording-upload/research.md` — design notes behind the recording upload flow
- `apps/web/CLAUDE.md` — the frontend that calls this API
