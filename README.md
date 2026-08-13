# video-meetings

pnpm workspace monorepo with two applications:

- `apps/api` — NestJS backend (TypeScript)
- `apps/web` — Next.js frontend (TypeScript, App Router)

`apps/web` is still at its initial scaffold stage (default Next.js starter template). `apps/api` has an auth module (email/password register & login, JWT issuance) and a JWT-protected meetings module (create/list/get meetings), backed by Postgres via Prisma. The two apps are not wired to each other yet.

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

## Commands

Run from the repo root. Scripts use `pnpm -r` (all workspace packages) or `pnpm --filter <app>` (one package) under the hood.

| Command                                            | Description                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| `pnpm dev` / `pnpm dev:api` / `pnpm dev:web`       | Run dev server(s)                                   |
| `pnpm build` / `pnpm build:api` / `pnpm build:web` | Build                                               |
| `pnpm lint` / `pnpm lint:api` / `pnpm lint:web`    | Lint                                                |
| `pnpm test` / `pnpm test:api`                      | Run tests (only `api` has a test suite)             |
| `pnpm format` / `pnpm format:check`                | Prettier across `apps/**/*.{ts,tsx,js,jsx,json,md}` |

### apps/api (NestJS)

Run from `apps/api/` (or via `pnpm --filter api <script>` from the repo root):

- `pnpm dev` (alias `start:dev`) — start with watch mode
- `pnpm start` — start once, no watch
- `pnpm start:debug` — watch mode with `--inspect-brk`
- `pnpm build` — Nest build to `dist/`
- `pnpm start:prod` — run the built `dist/main.js`
- `pnpm test` / `pnpm test:watch` / `pnpm test:cov` — unit tests
- `pnpm test:e2e` — e2e tests (requires `docker compose up -d postgres`)
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

## Development with Claude Code

This repo carries `CLAUDE.md` guidance files (root and per-app) plus vendored skills under `.claude/skills` for working with [Claude Code](https://claude.ai/code).
