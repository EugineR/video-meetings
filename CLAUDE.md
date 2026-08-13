# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

pnpm workspace monorepo (`pnpm-workspace.yaml`: `apps/*`) with two applications:

- `apps/api` — NestJS backend (TypeScript). See `apps/api/CLAUDE.md`.
- `apps/web` — Next.js frontend (TypeScript, App Router). See `apps/web/CLAUDE.md`.

`apps/web` is wired up with Tailwind CSS v4 and the HeroUI v3 component library (`@heroui/react`), with a `/register` page that calls the API and a home page (`/`) that redirects unauthenticated visitors to `/register` (client-side, via a `localStorage`-stored JWT — see `apps/web/CLAUDE.md`). `apps/api` now has an auth module (email/password register & login, JWT issuance) and a JWT-protected meetings module (create/list/get meetings), backed by Postgres via Prisma; see `apps/api/CLAUDE.md`. `apps/web` talks to `apps/api` over HTTP via `NEXT_PUBLIC_API_URL` (see `apps/web/CLAUDE.md`) — this is currently the only inter-app wiring.

## Commands

Run from the repo root. Scripts use `pnpm -r` (all workspace packages) or `pnpm --filter <app>` (one package) under the hood.

- `pnpm dev` / `pnpm dev:api` / `pnpm dev:web` — run dev server(s)
- `pnpm build` / `pnpm build:api` / `pnpm build:web` — build
- `pnpm lint` / `pnpm lint:api` / `pnpm lint:web` — lint
- `pnpm test` / `pnpm test:api` — run tests (only `api` has a test suite; see `apps/api/CLAUDE.md` for running a single test)
- `pnpm format` / `pnpm format:check` — Prettier across `apps/**/*.{ts,tsx,js,jsx,json,md}`

Requires Node >= 20; package manager is pinned via `packageManager: pnpm@11.20.0`.

## Database

`docker-compose.yml` at the repo root defines a `postgres` service (`postgres:16-alpine`) for local development. Start it with `docker compose up -d postgres`. Connection settings come from env vars documented in `.env.example` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`); data persists in the `postgres_data` volume. `apps/api` connects to it via Prisma — see `apps/api/CLAUDE.md` for the schema, migrations, and required `apps/api/.env` values.

## Formatting

Root `.prettierrc` sets `singleQuote: true, trailingComma: "all"` and applies repo-wide (each app also carries its own copy of the same config).

## Documentation

Whenever a change alters the project's architecture — new modules/services, changed repository structure, new inter-app wiring, new external dependencies (database, queue, third-party API), or new required commands/env vars — update the relevant documentation in the same change:

- Root `README.md` and this `CLAUDE.md` for repo-wide structure, commands, or requirements.
- `apps/api/CLAUDE.md` / `apps/web/CLAUDE.md` for changes scoped to one app's architecture or commands.

Do not let these files describe a structure that no longer matches the code.

## Testing UI changes

Any UI change (new component, styling change, layout change, etc.) is not considered complete until it has been visually verified using both of the following, in the same turn as the change:

- The `ui-ux-pro-max` skill — to check the change against design/UX guidelines (styles, color, typography, layout, accessibility, etc.).
- The Playwright MCP server (`mcp__playwright__*` tools) — not the `claude-in-chrome` extension — to actually load the page in a browser, interact with it, and check console/network output as needed.

Do not report a UI task as done without having run both checks.

## Git workflow

- Group related changes into one logical commit instead of committing after every small step. For example, when adding several skills, stage and commit them together once the set is complete — don't create a separate commit per skill.
- Do not `git push` unless the user explicitly asks for it in that turn. Committing locally does not imply permission to push; a prior push request does not carry over to later, unrelated changes.
