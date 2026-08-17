# video-meetings

pnpm workspace monorepo with two applications:

- `apps/api` — NestJS backend (TypeScript)
- `apps/web` — Next.js frontend (TypeScript, App Router)

`apps/web` is wired up with Tailwind CSS v4 and the [HeroUI v3](https://heroui.com) component library, with `/register` and `/login` pages that call the API and a home page (`/`) that redirects unauthenticated visitors to `/login`; once signed in, the home page lists the user's meetings (all of them, plus the 3 most recent), each row showing an "Upload" button (no recording yet) or a "Recording" badge and opening `/meetings/{id}` on click. That page shows the meeting's details plus its recording: an upload area (drag & drop or file picker, with progress and cancel) when there is none, or a player with filename/size/date/status and Replace/Delete actions when there is. `apps/api` has an auth module (email/password register & login, JWT issuance) and a JWT-protected meetings module (create/list/get meetings, plus upload/stream/delete a recording file per meeting), backed by Postgres via Prisma and local-disk file storage. `apps/web` talks to `apps/api` over HTTP via `NEXT_PUBLIC_API_URL` — this is currently the only inter-app wiring.

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

Uploaded meeting recordings are stored on `apps/api`'s local filesystem under `UPLOADS_DIR` (default `uploads/`, relative to `apps/api/`; gitignored/dockerignored, created on demand). Configure `UPLOADS_DIR`, `MAX_UPLOAD_SIZE_BYTES` and `ALLOWED_RECORDING_MIME_TYPES` in `apps/api/.env` (see `apps/api/.env.example`).

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
- `pnpm test:e2e` — e2e tests, covering `auth` and `meetings` (requires `docker compose up -d postgres`)
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

[Husky](https://typicode.github.io/husky/) is installed (`prepare` script, runs automatically on `pnpm install`). A `pre-commit` hook (`.husky/pre-commit`) runs `pnpm lint && pnpm test` before every commit, blocking it on lint errors or test failures.

## Development with Claude Code

This repo carries `CLAUDE.md` guidance files (root and per-app) plus vendored skills under `.claude/skills` for working with [Claude Code](https://claude.ai/code).
