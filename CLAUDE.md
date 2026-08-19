# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

pnpm workspace monorepo (`pnpm-workspace.yaml`: `apps/*`) with two applications:

- `apps/api` — NestJS backend (TypeScript): an auth module (email/password register & login, JWT issuance) and a JWT-protected meetings module (create/list/get meetings, plus upload/stream/delete one recording file per meeting), backed by Postgres via Prisma. See `apps/api/CLAUDE.md`.
- `apps/web` — Next.js frontend (TypeScript, App Router) on Tailwind CSS v4 and HeroUI v3: `/register` and `/login`, a home page (`/`) listing the signed-in user's meetings, and `/meetings/{id}` with the meeting's details and its recording (player or uploader). Auth is client-side only, via a `localStorage`-stored JWT. See `apps/web/CLAUDE.md`.

`apps/web` talks to `apps/api` over HTTP via `NEXT_PUBLIC_API_URL` (see `apps/web/CLAUDE.md`) — this is currently the only inter-app wiring. Each app's own architecture is described in its own `CLAUDE.md`; don't restate it here.

## Commands

Run from the repo root; the scripts themselves live in `package.json`. Each has `:api`/`:web` variants (`pnpm dev:api`, `pnpm lint:web`, …): `dev`, `build`, `lint`, `test` (only `api` has a test suite — see `apps/api/CLAUDE.md` for single-test and e2e invocations), plus `format` / `format:check` (Prettier over `apps/**`).

Requires Node >= 20; package manager is pinned via `packageManager: pnpm@11.20.0`.

## Token efficiency

Prefer the narrow form of a command; read the part of a file you need, not the whole file.

- `git diff --stat` first, then `git diff -- <path>` for the file that actually matters.
- `git log --oneline -10` — never bare `git log`.
- `gh issue list --json number,title,state --limit 20`; `gh pr view <n> --json title,body`.
- Tests: run the narrowest scope — `pnpm test:api -- <name>.spec.ts`, or `-- -t "case name"`. The pre-commit hook runs the full suite anyway, so don't pre-run it.
- Types: `pnpm --filter api exec tsc --noEmit 2>&1 | head -30` (errors print in source order — `head`, not `tail`).
- `pnpm lint` runs ESLint with `--fix`; read its output instead of re-running it to confirm.

## Database

`docker-compose.yml` at the repo root defines a `postgres` service (`postgres:16-alpine`) for local development. Start it with `docker compose up -d postgres`. Connection settings come from env vars documented in `.env.example` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`); data persists in the `postgres_data` volume. `apps/api` connects to it via Prisma — see `apps/api/CLAUDE.md` for the schema, migrations, and required `apps/api/.env` values.

## Formatting

Root `.prettierrc` sets `singleQuote: true, trailingComma: "all"` and applies repo-wide (each app also carries its own copy of the same config).

## Language

Everything written into the repository is in English — code, comments, identifiers, commit messages, pull request bodies, documentation under `docs/`, and any console or log output a tool produces. A conversation with the author may happen in another language; that never changes what lands in the repo.

## Documentation

Whenever a change alters the project's architecture — new modules/services, changed repository structure, new inter-app wiring, new external dependencies (database, queue, third-party API), or new required commands/env vars — update the relevant documentation in the same change:

- Root `README.md` and this `CLAUDE.md` for repo-wide structure, commands, or requirements.
- `apps/api/CLAUDE.md` / `apps/web/CLAUDE.md` for changes scoped to one app's architecture or commands.

Do not let these files describe a structure that no longer matches the code. This is the only place the rule is stated — the per-app files don't repeat it.

Feature documentation lives in `docs/`, one folder per feature named after it in kebab-case (`docs/meeting-recording-upload/`), holding `prd.md`, `plan.md` and any research notes (`research.md`). Add new PRDs, plans and research to the matching feature folder rather than to `docs/` directly. Reference such a file by plain path, never with an `@` prefix — an `@path` is an inline import that loads the whole file into every session's context.

## Git workflow

- Group related changes into one logical commit instead of committing after every small step. For example, when adding several skills, stage and commit them together once the set is complete — don't create a separate commit per skill.
- Do not `git push` unless the user explicitly asks for it in that turn. Committing locally does not imply permission to push; a prior push request does not carry over to later, unrelated changes.
- Husky (`prepare` script, runs on `pnpm install`) installs a `pre-commit` hook (`.husky/pre-commit`) that runs `pnpm lint && pnpm test`, blocking the commit on lint errors or test failures.

## Ralph loop

`node .claude/ralph-start.js` drives an autonomous loop over a feature backlog: one Claude session per GitHub issue, one branch per phase, each phase reviewed and then merged `--no-ff` into a long-lived feature branch and tagged `ralph/phase-N`, so phases stay revertable while the feature is in progress. Phases are catalogued in `.claude/ralph.config.json`; which of them a given run executes is chosen with flags (`--dry-run`, `--phases N`, `--only`), never by editing the catalogue. Per-session rules for the implementing agent live in `.claude/ralph.md`.

The orchestrator never writes to `master`: once every phase is merged it opens a single pull request for the whole feature and stops, leaving the merge to a human (with a merge commit, never a squash, so issue-level history survives). It owns the loop end to end — there is deliberately no Stop hook involved. Design rationale is in `docs/ralph-loop-rework/plan.md`, the developer guide in `docs/ralph-loop-rework/usage.md`. Runtime state (`ralph.log`, `ralph.stats.jsonl`, `ralph.stop`) is gitignored.
