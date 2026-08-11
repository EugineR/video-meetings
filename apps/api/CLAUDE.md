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
- `pnpm prisma:generate` (alias for `prisma generate`) — regenerate the Prisma Client after editing `prisma/schema.prisma`; also runs automatically on `pnpm install` via `postinstall`
- `pnpm prisma:migrate` (alias for `prisma migrate dev`) — create/apply a migration against the local database

## Architecture

- `src/main.ts` — bootstraps `AppModule` via `NestFactory`
- `src/app.module.ts` — root module. Imports `ConfigModule` (global), `PrismaModule`, `AuthModule`; registers a global `ValidationPipe` (`whitelist: true, transform: true`) via `APP_PIPE`
- `src/app.controller.ts` / `src/app.service.ts` — scaffold feature (root `GET /` hello-world)
- `src/prisma/` — `PrismaModule` (`@Global()`) and `PrismaService`, a `PrismaClient` subclass connected via the `@prisma/adapter-pg` driver adapter (Prisma 7 requires a driver adapter; the connection string can no longer live in `schema.prisma`), reading `DATABASE_URL` through `ConfigService`. Connects on `onModuleInit`, disconnects on `onModuleDestroy`
- `src/users/` — `UsersModule` exporting `UsersRepository` (thin Prisma wrapper: `findByEmail`, `create`)
- `src/auth/` — `AuthModule`, built with CQRS (`@nestjs/cqrs`):
  - `AuthController` (`POST /auth/register` → 201, `POST /auth/login` → 200, both returning `{ accessToken }`) depends only on `CommandBus`/`QueryBus`, not on a service.
  - `commands/register-user.command.ts` + `commands/handlers/register-user.handler.ts` — `RegisterUserCommand`/`RegisterUserHandler` (mutates state: checks email uniqueness, hashes the password with `bcryptjs`, creates the user).
  - `queries/login-user.query.ts` + `queries/handlers/login-user.handler.ts` — `LoginUserQuery`/`LoginUserHandler` (read-only: looks up the user, verifies the password). Modeled as a query rather than a command because it doesn't mutate persisted state.
  - `token.service.ts` — `TokenService`, the shared JWT-signing provider (`@nestjs/jwt`, `JWT_SECRET`/1h expiry from `ConfigService`) used by both handlers.
  - `dto/` — `RegisterDto`/`LoginDto`, validated by `class-validator`.
  - `interfaces/access-token-response.interface.ts` — shared `{ accessToken: string }` response shape.
  - Register on a taken email throws `ConflictException` (409); bad login credentials throw `UnauthorizedException` (401).

Jest config for unit tests lives inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts`); e2e tests have their own config at `test/jest-e2e.json`. `test/auth.e2e-spec.ts` runs against the real Postgres database from `docker-compose.yml` (via Prisma) and truncates the `users` table in a `beforeEach` for isolation — `docker compose up -d postgres` must be running before `pnpm test:e2e`.

ESLint (`eslint.config.mjs`) uses `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`; notably `@typescript-eslint/no-explicit-any` is off, and `no-floating-promises` / `no-unsafe-argument` are warnings, not errors.

## Database (Prisma)

- Schema: `prisma/schema.prisma` (currently one `User` model, mapped to the `users` table). Migrations live in `prisma/migrations/`.
- CLI config: `prisma.config.ts` (reads `DATABASE_URL` via `dotenv/config`) — used by `prisma migrate`/`prisma generate`, separate from the app's own `ConfigModule`-based runtime connection in `PrismaService`.
- Generated client: `generated/prisma`-style output is not used here — the schema uses the classic `prisma-client-js` generator, so the client is generated into `node_modules/@prisma/client` and imported as `import { PrismaClient } from '@prisma/client'`.
- Required env vars (`apps/api/.env`, see `.env.example`): `DATABASE_URL` (Postgres connection string — must match the credentials in the root `docker-compose.yml`/`​.env.example`) and `JWT_SECRET`.

## Documentation

When this app's architecture changes (new modules, external services, commands), update this file and the root `CLAUDE.md`/`README.md` so they stay accurate.
