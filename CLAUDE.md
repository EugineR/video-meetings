# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

pnpm workspace monorepo (`pnpm-workspace.yaml`: `apps/*`) with two applications:

- `apps/api` — NestJS backend (TypeScript). See `apps/api/CLAUDE.md`.
- `apps/web` — Next.js frontend (TypeScript, App Router). See `apps/web/CLAUDE.md`.

Both apps are currently at their initial scaffold stage (default NestJS/Next.js starter templates) with no custom domain logic yet, and are not wired to each other.

## Commands

Run from the repo root. Scripts use `pnpm -r` (all workspace packages) or `pnpm --filter <app>` (one package) under the hood.

- `pnpm dev` / `pnpm dev:api` / `pnpm dev:web` — run dev server(s)
- `pnpm build` / `pnpm build:api` / `pnpm build:web` — build
- `pnpm lint` / `pnpm lint:api` / `pnpm lint:web` — lint
- `pnpm test` / `pnpm test:api` — run tests (only `api` has a test suite; see `apps/api/CLAUDE.md` for running a single test)
- `pnpm format` / `pnpm format:check` — Prettier across `apps/**/*.{ts,tsx,js,jsx,json,md}`

Requires Node >= 20; package manager is pinned via `packageManager: pnpm@11.20.0`.

## Formatting

Root `.prettierrc` sets `singleQuote: true, trailingComma: "all"` and applies repo-wide (each app also carries its own copy of the same config).

## Documentation

Whenever a change alters the project's architecture — new modules/services, changed repository structure, new inter-app wiring, new external dependencies (database, queue, third-party API), or new required commands/env vars — update the relevant documentation in the same change:

- Root `README.md` and this `CLAUDE.md` for repo-wide structure, commands, or requirements.
- `apps/api/CLAUDE.md` / `apps/web/CLAUDE.md` for changes scoped to one app's architecture or commands.

Do not let these files describe a structure that no longer matches the code.
