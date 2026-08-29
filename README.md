# video-meetings

pnpm workspace monorepo with two applications:

- `apps/api` — NestJS backend (TypeScript)
- `apps/web` — Next.js frontend (TypeScript, App Router)

`apps/web` is wired up with Tailwind CSS v4, the [HeroUI v3](https://heroui.com) component library and [TanStack Query](https://tanstack.com/query) (`@tanstack/react-query`, which caches everything fetched from `apps/api` so the same data is not requested once per page), with `/register` and `/login` pages that call the API and a home page (`/`) that redirects unauthenticated visitors to `/login`; once signed in, the home page lets the user create a meeting by hand (a "+ Create meeting" modal — title, date, participants) and lists the user's meetings (all of them, plus the 3 most recent), each row showing an "Upload" button (no recording yet) or a file-count badge and opening `/meetings/{id}` on click. That page has a back button (browser-history-based) above the meeting's details, plus its recordings: a list of every uploaded file, each with its own video/audio player, filename/size/date/status, transcription status and (once done) transcript text, and a Delete action independent of any other file on the meeting, followed by an always-present upload area (drag & drop or file picker, with progress and cancel) for adding another file. The header on the home page, a meeting's page, and the profile pages links its logo/title to `/`, and shows the signed-in user's avatar (or initials) and display name, linking to `/profile`, a read-only page with the account's identity and registration date; `/profile/edit` lets the user change their display name, password and avatar (upload, replace or remove, with a live preview and progress) without losing the session. `apps/api` has an auth module (email/password register & login, JWT issuance), a JWT-protected meetings module (create/list/get meetings, plus upload/stream/delete any number of recording files — mp4/webm/mov video or mp3 audio — per meeting), a transcription module that runs a local Whisper `base` model against each recording in the background after its upload and persists its own status/transcript, and a JWT-protected users module (own-profile read/update, password change, plus upload/stream/delete an avatar image), backed by Postgres via Prisma and local-disk file storage. `apps/web` talks to `apps/api` over HTTP via `NEXT_PUBLIC_API_URL` — this is currently the only inter-app wiring.

## Requirements

- Node >= 20
- pnpm (pinned via `packageManager: pnpm@11.20.0`)

## Getting started

```bash
pnpm install
```

### Database

A Postgres instance is provided via Docker Compose (`docker-compose.yml`, service `postgres`, image `postgres:16-alpine`):

```bash
docker compose up -d postgres
```

Connection settings are read from environment variables (see `.env.example`): `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (default `5432`). Data persists in the `postgres_data` Docker volume.

`apps/api` connects to this database via [Prisma](https://www.prisma.io/). Copy `apps/api/.env.example` to `apps/api/.env` (set `DATABASE_URL` to match the Postgres credentials above, and a `JWT_SECRET`), then run migrations:

```bash
docker compose up -d postgres
pnpm --filter api prisma:migrate
```

### Recording storage

Uploaded meeting recordings are stored on `apps/api`'s local filesystem under `UPLOADS_DIR` (default `uploads/`, relative to `apps/api/`; gitignored/dockerignored, created on demand). A meeting can hold any number of recording files. Allowed recording types are `video/mp4`, `video/webm`, `video/quicktime` and `audio/mpeg` (mp3). Configure `UPLOADS_DIR`, `MAX_UPLOAD_SIZE_BYTES` and `ALLOWED_RECORDING_MIME_TYPES` in `apps/api/.env` (see `apps/api/.env.example`).

### Transcription

Right after a recording upload succeeds, `apps/api` transcribes that file in the background using a local Whisper `base` model (no external transcription API), moving its status through `UPLOADED` → `PROCESSING` → `READY` (with transcript text) or `FAILED`, independently of any other recording on the same meeting. `apps/web`'s meeting page polls while any of a meeting's recordings has status `UPLOADED`/`PROCESSING` and shows each one's transcript once it's `READY`. Configure `WHISPER_MODEL_DIR` in `apps/api/.env` — where the local Whisper `base` model is downloaded to/read from; leave it unset to use the library's own default location.

### Meeting summaries

Once a recording's transcript is `READY`, `apps/api` generates a per-meeting summary, action items and decisions in the background via the Claude Agent SDK, re-running as further recordings finish so a multi-recording meeting converges on one result. This requires `CLAUDE_CODE_OAUTH_TOKEN` to be set in `apps/api/.env` (see `apps/api/.env.example`) — the SDK subprocess reads it directly from the process environment.

### Avatar storage

Uploaded user avatars are stored the same way, under `{UPLOADS_DIR}/avatars/{userId}/`. Configure `MAX_AVATAR_SIZE_BYTES` and `ALLOWED_AVATAR_MIME_TYPES` in `apps/api/.env` (see `apps/api/.env.example`).

### apps/web ↔ apps/api

`apps/web` calls `apps/api` over HTTP using the base URL in `NEXT_PUBLIC_API_URL` (see `apps/web/.env.example`, defaults to `http://localhost:3001`). Copy `apps/web/.env.example` to `apps/web/.env` if you need to override it (e.g. a different API port).

## Commands

Run from the repo root. Scripts use `pnpm -r` (all workspace packages) or `pnpm --filter <app>` (one package) under the hood.

| Command                                            | Description                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev` / `pnpm dev:api` / `pnpm dev:web`       | Run dev server(s)                                   |
| `pnpm build` / `pnpm build:api` / `pnpm build:web` | Build                                               |
| `pnpm lint` / `pnpm lint:api` / `pnpm lint:web`    | Lint                                                |
| `pnpm test` / `pnpm test:api`                      | Run unit tests (only `api` has a test suite)        |
| `pnpm format` / `pnpm format:check`                | Prettier across `apps/**/*.{ts,tsx,js,jsx,json,md}` |

### apps/api (NestJS)

Run from `apps/api/` (or via `pnpm --filter api <script>` from the repo root):

- `pnpm dev` (alias `start:dev`) — start with watch mode
- `pnpm start` — start once, no watch
- `pnpm start:debug` — watch mode with `--inspect-brk`
- `pnpm build` — Nest build to `dist/`
- `pnpm start:prod` — run the built `dist/main.js`
- `pnpm test` / `pnpm test:watch` / `pnpm test:cov` — unit tests (none exist yet — see `apps/api/CLAUDE.md`)
- `pnpm test:e2e` — e2e tests, covering `auth`, `meetings` and the user profile/avatar routes (requires `docker compose up -d postgres`)
- `pnpm prisma:generate` — regenerate the Prisma Client
- `pnpm prisma:migrate` — create/apply a Prisma migration

### apps/web (Next.js)

Run from `apps/web/` (or via `pnpm --filter web <script>` from the repo root):

- `pnpm dev` — Next.js dev server (default port 3000)
- `pnpm build` — production build
- `pnpm start` — serve the production build

No test suite is configured for this app.

## Formatting

Root `.prettierrc` sets `singleQuote: true, trailingComma: "all"` and applies repo-wide (each app also carries its own copy of the same config).

## Git hooks

[Husky](https://typicode.github.io/husky/) is installed (`prepare` script, runs automatically on `pnpm install`). A `pre-commit` hook (`.husky/pre-commit`) runs `pnpm lint && pnpm test && pnpm test:ralph && pnpm check:links` before every commit, blocking it on lint errors, test failures or a broken documentation link.

## Development with Claude Code

This repo carries `CLAUDE.md` guidance files (root and per-app) plus vendored skills under `.claude/skills` for working with [Claude Code](https://claude.ai/code).

Those guidance files stay small on purpose — an agent loads them before it does anything. The per-file reference material lives beside them, read on demand rather than resident:

- `docs/architecture/api.md` / `docs/architecture/web.md` — every module, page, component and library file
- `docs/testing/api.md` / `docs/testing/web.md` — what the suites cover, and how a UI change is verified
