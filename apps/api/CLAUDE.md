# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from `apps/api/` (or via `pnpm --filter api <script>` from the repo root):

- `pnpm dev` (alias `start:dev`) — start with watch mode
- `pnpm start` — start once, no watch
- `pnpm start:debug` — watch mode with `--inspect-brk`
- `pnpm build` — Nest build to `dist/`
- `pnpm start:prod` — run the built `dist/main.js`
- `pnpm lint` — ESLint with `--fix` over `src`, `apps`, `libs`, `test`
- `pnpm test` — Jest unit tests (`*.spec.ts` under `src`)
- `pnpm test:watch` / `pnpm test:cov` — watch mode / coverage
- `pnpm test:e2e` — e2e tests via `test/jest-e2e.json` (`*.e2e-spec.ts` under `test`)
- Single test file: `pnpm test -- app.controller.spec.ts` (Jest pattern match); a single test case: `pnpm test -- -t "test name"`

## Architecture

Standard NestJS starter layout, unmodified from scaffold:

- `src/main.ts` — bootstraps `AppModule` via `NestFactory`
- `src/app.module.ts` — root module; registers controllers/providers here as they're added
- `src/app.controller.ts` / `src/app.service.ts` — the only feature currently present (root `GET /` hello-world)

Jest config for unit tests lives inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts`); e2e tests have their own config at `test/jest-e2e.json`.

ESLint (`eslint.config.mjs`) uses `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`; notably `@typescript-eslint/no-explicit-any` is off, and `no-floating-promises` / `no-unsafe-argument` are warnings, not errors.
