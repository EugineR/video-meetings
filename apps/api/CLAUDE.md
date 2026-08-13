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

- `src/main.ts` — bootstraps `AppModule` via `NestFactory`; enables CORS restricted to `WEB_URL` (default `http://localhost:3000`) so `apps/web` can call this API from the browser
- `src/app.module.ts` — root module. Imports `ConfigModule` (global), `PrismaModule`, `AuthModule`, `MeetingsModule`; registers a global `ValidationPipe` (`whitelist: true, transform: true`) via `APP_PIPE`
- `src/app.controller.ts` / `src/app.service.ts` — scaffold feature (root `GET /` hello-world)
- `src/prisma/` — `PrismaModule` (`@Global()`) and `PrismaService`, a `PrismaClient` subclass connected via the `@prisma/adapter-pg` driver adapter (Prisma 7 requires a driver adapter; the connection string can no longer live in `schema.prisma`), reading `DATABASE_URL` through `ConfigService`. Connects on `onModuleInit`, disconnects on `onModuleDestroy`
- `src/users/` — `UsersModule` exporting `UsersRepository` (thin Prisma wrapper: `findByEmail`, `create`)
- `src/auth/` — `AuthModule`, built with CQRS (`@nestjs/cqrs`); see [CQRS pattern](#cqrs-pattern) for the general convention it establishes:
  - `AuthController` (`POST /auth/register` → 201, `POST /auth/login` → 200, both returning `{ accessToken }`) depends only on `CommandBus`/`QueryBus`, not on a service.
  - `commands/register-user.command.ts` + `commands/handlers/register-user.handler.ts` — `RegisterUserCommand`/`RegisterUserHandler` (mutates state: checks email uniqueness, hashes the password with `bcryptjs`, creates the user).
  - `queries/login-user.query.ts` + `queries/handlers/login-user.handler.ts` — `LoginUserQuery`/`LoginUserHandler` (read-only: looks up the user, verifies the password). Modeled as a query rather than a command because it doesn't mutate persisted state.
  - `token.service.ts` — `TokenService`, the shared JWT-signing provider (`@nestjs/jwt`, `JWT_SECRET`/1h expiry from `ConfigService`) used by both handlers.
  - `dto/` — `RegisterDto`/`LoginDto`, validated by `class-validator`.
  - `interfaces/access-token-response.interface.ts` — shared `{ accessToken: string }` response shape.
  - `interfaces/jwt-payload.interface.ts` — the decoded JWT shape, `{ sub: string; email: string }` (matches what `TokenService.sign` puts in the token).
  - `guards/jwt-auth.guard.ts` — `JwtAuthGuard`, a `CanActivate` guard that reads the `Authorization: Bearer <token>` header, verifies it via `JwtService.verifyAsync`, and attaches the decoded `JwtPayload` to `request.user`; throws `UnauthorizedException` (401) when the header is missing or the token is invalid/expired.
  - `decorators/current-user.decorator.ts` — `@CurrentUser()` param decorator, reads `request.user` (set by `JwtAuthGuard`) and returns it typed as `JwtPayload`.
  - Register on a taken email throws `ConflictException` (409); bad login credentials throw `UnauthorizedException` (401).
  - `AuthModule` exports `JwtModule` and `JwtAuthGuard` so other feature modules can import `AuthModule` to protect their own routes with the same guard/decorator pair instead of re-registering `JwtModule`.
- `src/meetings/` — `MeetingsModule`, built with CQRS, importing `AuthModule` to reuse `JwtAuthGuard`/`@CurrentUser()`:
  - `MeetingsController`, guarded with `@UseGuards(JwtAuthGuard)` at the class level (`POST /meetings` → 201, `GET /meetings` → 200, `GET /meetings/:id` → 200/404), all three routes read the caller's id via `@CurrentUser()`.
  - `commands/create-meeting.command.ts` + `commands/handlers/create-meeting.handler.ts` — `CreateMeetingCommand`/`CreateMeetingHandler` (mutates state: creates a meeting owned by the current user).
  - `queries/get-meetings.query.ts` + `queries/handlers/get-meetings.handler.ts` — lists meetings owned by the current user.
  - `queries/get-meeting-by-id.query.ts` + `queries/handlers/get-meeting-by-id.handler.ts` — looks up a single meeting scoped to `(id, ownerId)`; throws `NotFoundException` (404) both when the id doesn't exist and when it belongs to a different user, so ownership is never leaked via the status code.
  - `meetings.repository.ts` — `MeetingsRepository` (thin Prisma wrapper: `create`, `findAllByOwner`, `findByIdAndOwner`), declared directly in `MeetingsModule` (no other module currently needs it).
  - `dto/create-meeting.dto.ts` — `CreateMeetingDto` (`title`: non-empty string, `date`: ISO-8601 date string, `participants`: array of email strings), validated by `class-validator`.
  - No `MeetingResponse` DTO — handlers return the Prisma `Meeting` model directly (same convention as `auth`/`users`).

## CQRS pattern

Every feature module that mutates or reads persisted state follows the `@nestjs/cqrs` convention established by `auth/` (see above) and reused by later modules (e.g. `meetings/`). New feature modules should follow the same shape rather than inventing a new one:

- **Commands** (`commands/<name>.command.ts` + `commands/handlers/<name>.handler.ts`) are for anything that mutates state (create/update/delete). The command class is a plain constructor-only data carrier with no logic. Its handler is decorated `@CommandHandler(XCommand)` and implements `ICommandHandler<XCommand, TResult>`.
- **Queries** (`queries/<name>.query.ts` + `queries/handlers/<name>.handler.ts`) are for anything read-only — including reads that do non-trivial work, as long as they don't persist anything. `LoginUserQuery` is the reference example: it looks up a user and verifies a password hash, but is a query (not a command) because nothing is written to the database.
- **Controllers stay thin.** They inject `CommandBus`/`QueryBus` only — never a repository or a handler directly — and each route handler is a single `commandBus.execute(new XCommand(...))` or `queryBus.execute(new XQuery(...))` call, typed to return the handler's result.
- **Handlers hold the logic.** They inject one or more thin repositories (one per aggregate, e.g. `UsersRepository`, `MeetingsRepository` — each a near-1:1 wrapper around a `PrismaService` call, returning the Prisma model type directly) plus any shared services (e.g. `TokenService`). Handlers throw Nest's built-in HTTP exceptions directly where a business rule is violated (`ConflictException`, `UnauthorizedException`, `NotFoundException`, …) — there is no separate exception-mapping layer.
- **Module wiring:** each feature module imports `CqrsModule`, declares local `CommandHandlers`/`QueryHandlers` arrays, and registers `providers: [...CommandHandlers, ...QueryHandlers]` alongside its controller and any module-local services. Repositories are declared/exported by their own small module (`UsersModule`, `MeetingsModule`) so other feature modules can import and reuse them instead of redeclaring Prisma access.
- **DTOs vs commands/queries:** HTTP-facing validation lives in `dto/*.ts` (`class-validator` decorators); controllers map a validated DTO onto a command/query instance. Commands/queries themselves carry no validation logic — by the time a handler sees one, the shape is already trusted.

Jest config for unit tests lives inline in `package.json` (`rootDir: "src"`, matches `*.spec.ts`); e2e tests have their own config at `test/jest-e2e.json`. `test/auth.e2e-spec.ts` and `test/meetings.e2e-spec.ts` run against the real Postgres database from `docker-compose.yml` (via Prisma) and truncate their tables (`users`, and `meetings`+`users`) in a `beforeEach` for isolation — `docker compose up -d postgres` must be running before `pnpm test:e2e`. Because multiple e2e spec files share and truncate the same real database, `test/jest-e2e.json` sets `"maxWorkers": 1` so suites run serially; without it, Jest's default parallel workers can interleave one file's `deleteMany()` with another file's in-flight test and cause spurious foreign-key errors.

ESLint (`eslint.config.mjs`) uses `typescript-eslint` recommendedTypeChecked + `eslint-plugin-prettier`; notably `@typescript-eslint/no-explicit-any` is off, and `no-floating-promises` / `no-unsafe-argument` are warnings, not errors.

## Database (Prisma)

- Schema: `prisma/schema.prisma` — `User` (mapped to `users`) and `Meeting` (mapped to `meetings`, `ownerId` FK to `User` with `onDelete: Cascade`, `participants` stored as a native Postgres `String[]` column rather than a separate join table). Migrations live in `prisma/migrations/`.
- CLI config: `prisma.config.ts` (reads `DATABASE_URL` via `dotenv/config`) — used by `prisma migrate`/`prisma generate`, separate from the app's own `ConfigModule`-based runtime connection in `PrismaService`.
- Generated client: `generated/prisma`-style output is not used here — the schema uses the classic `prisma-client-js` generator, so the client is generated into `node_modules/@prisma/client` and imported as `import { PrismaClient } from '@prisma/client'`.
- Required env vars (`apps/api/.env`, see `.env.example`): `DATABASE_URL` (Postgres connection string — must match the credentials in the root `docker-compose.yml`/`​.env.example`) and `JWT_SECRET`. `PORT` (default `3001` in `.env`/`.env.example`) sets the HTTP listen port in `src/main.ts` — it must differ from `apps/web`'s port (3000) since both apps are run together via `pnpm dev`. `WEB_URL` (default `http://localhost:3000`) sets the allowed CORS origin in `src/main.ts` — it must match wherever `apps/web` is actually served from.

## Documentation

When this app's architecture changes (new modules, external services, commands), update this file and the root `CLAUDE.md`/`README.md` so they stay accurate.
