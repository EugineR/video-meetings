# Plan: User Profile Page and Profile Editing

**PRD:** docs/user-profile-page-and-editing/prd.md
**Date:** 2026-08-18

## Implementation Phases

### Phase 1: Profile read & display name API (Tracer Bullet)

**Goal:** A signed-in user can read their own profile and set/clear a display name through the API — the minimum end-to-end path (DB column → repository → CQRS → guarded HTTP route) with no file handling involved.
**Affects:** backend, database
**Tasks:**

- [ ] Write `test/users-profile.e2e-spec.ts` up front (expected to fail red): `GET /users/me` returns `id`/`email`/`name`/`createdAt` for the token's own user; `PATCH /users/me` with `{ "name": "Jane Doe" }` is reflected by a follow-up `GET`; `{ "name": "   " }` stores `null`; a name over 100 characters returns 400 and leaves the stored name unchanged; both routes return 401 without a token; a token for user A never returns user B's profile
- [ ] Add `name String?` to the `User` model in `apps/api/prisma/schema.prisma` and create the additive migration (no backfill)
- [ ] Extend `UsersRepository` with `findById` and `updateName`
- [ ] Add `GetProfileQuery` + handler, `UpdateProfileCommand` + handler and `UpdateProfileDto` (`name?: string | null`, trimmed, empty → `null`, `@MaxLength(100)`) following the existing CQRS convention, registered in `UsersModule`
- [ ] Add `UsersController` (`@UseGuards(JwtAuthGuard)`, `@Controller('users')`) with `GET /users/me` and `PATCH /users/me`, both resolving the user strictly from `user.sub` via `@CurrentUser()`, returning the `ProfileResponse` interface

**Done when:** the e2e spec above passes green, `pnpm prisma:migrate` applies the migration on an existing database with untouched rows, and `pnpm lint` / `pnpm test` pass.

### Phase 2: Password change API

**Goal:** A signed-in user can change their password by supplying the current one, and receives a freshly signed token so the session survives.
**Affects:** backend
**Tasks:**

- [ ] Extend `test/users-profile.e2e-spec.ts` up front (expected to fail red): correct current password → 200 with a new `accessToken` that authenticates `GET /users/me`, `POST /auth/login` then succeeds with the new password and fails with the old one; wrong current password → 400 with the stored hash unchanged (login with the original password still works); new password equal to the current one → 400; no token → 401
- [ ] Extract `PASSWORD_SALT_ROUNDS` from `RegisterUserHandler` into a shared constant so registration and password change hash identically, and cover the password-change validation rules (minimum length, new ≠ current) with a unit spec in the existing `*.spec.ts` style
- [ ] Extend `UsersRepository` with `updatePassword`
- [ ] Add `ChangePasswordDto` (`currentPassword`, `newPassword`) plus `ChangePasswordCommand` + handler: verify the current password with `bcrypt.compare` (400 on mismatch), reject a new password equal to the current one, hash and persist, then return `{ accessToken }` signed via the existing `TokenService`
- [ ] Wire `POST /users/me/password` on `UsersController` behind `JwtAuthGuard`, returning 200 with the new token

**Done when:** the extended e2e spec passes green, a password changed through the API is usable at `POST /auth/login` while the old one is rejected, and `pnpm lint` / `pnpm test` pass.

### Phase 3: Avatar storage & upload/delete API

**Goal:** A signed-in user can upload an avatar (replacing any existing one) and delete it, with the file written to and removed from local disk.
**Affects:** backend, database
**Tasks:**

- [ ] Write `test/users-avatar.e2e-spec.ts` up front (expected to fail red): PNG/JPEG/WebP upload → 201 with metadata and a file under `{UPLOADS_DIR}/avatars/{userId}/`; a second upload replaces the first (one row, only the new file on disk); `.txt` file and a `.png` sent with a disallowed MIME type → 415 with nothing written; a file above `MAX_AVATAR_SIZE_BYTES` → 413 with nothing written; `DELETE` → 204 with the file gone, a repeat `DELETE` → 404; both routes 401 without a token
- [ ] Add the `UserAvatar` model (`@@map("user_avatars")`: `id`, `userId` FK to `User` with `onDelete: Cascade` and `@unique`, `originalFilename`, `storagePath`, `mimeType`, `sizeBytes` as `BigInt`, `createdAt`, `updatedAt`) and create the migration
- [ ] Add `avatar-file-filter.ts` (MIME allowlist + extension mapping for `image/jpeg`/`image/png`/`image/webp`, bootstrap-time assertion of unknown MIME types) with `avatar-file-filter.spec.ts`, mirroring `recording-file-filter`; add `MAX_AVATAR_SIZE_BYTES` (5 MB) and `ALLOWED_AVATAR_MIME_TYPES` to `apps/api/.env.example` and the root `.env.example`
- [ ] Generalise `StorageService` path resolution so avatars live at `{UPLOADS_DIR}/avatars/{userId}/{uuid}{ext}` while keeping the UUID-based path-traversal guard intact for both meeting and user ids
- [ ] Add `UserAvatarsRepository` plus `UploadAvatarCommand`/`DeleteAvatarCommand` + handlers (write new file → upsert row → delete the previous file; 404 on delete with no avatar) and wire `POST /users/me/avatar` (`FileInterceptor` on field `file`, `multer` `limits.fileSize` → 413, allowlist → 415, missing file → 400) and `DELETE /users/me/avatar` (204) on `UsersController`

**Done when:** the avatar e2e spec passes green for upload, replace and delete including every listed error code, and `pnpm lint` / `pnpm test` pass.

### Phase 4: Avatar streaming & profile response integration

**Goal:** The backend feature is complete: the stored avatar can be fetched as an image by an `<img>` tag, and the profile endpoint reports whether one exists.
**Affects:** backend
**Tasks:**

- [ ] Extend `test/users-avatar.e2e-spec.ts` up front (expected to fail red): `GET /users/me/avatar` returns the exact uploaded bytes with the matching `Content-Type`; 404 when there is no avatar; the route authenticates via `?token=` as well as the `Authorization` header; `GET /users/me` reports `hasAvatar`/`avatarUpdatedAt` correctly before and after upload and delete; deleting a user cascades away the `user_avatars` row
- [ ] Add `GetAvatarQuery` + handler returning the stream and validated metadata via `StorageService.createReadStream`
- [ ] Wire `GET /users/me/avatar` on `UsersController` with `@AllowQueryToken()`, setting `Content-Type` from the stored (allowlist-validated) MIME type — never from client input — plus `Content-Length` and `Cache-Control: no-cache`
- [ ] Extend the `GetProfileQuery` handler and `ProfileResponse` with `hasAvatar` and `avatarUpdatedAt`, serialising `sizeBytes` to a `string` at the API boundary wherever avatar metadata is returned
- [ ] Update `apps/api/CLAUDE.md`, the root `CLAUDE.md`/`README.md` and both `.env.example` files for the new routes, model and env vars

**Done when:** both e2e specs pass green, an avatar uploaded through the API can be fetched back byte-identical via `?token=`, and `pnpm lint` / `pnpm test` pass.

### Phase 5: Web API client, profile state & header identity

**Goal:** The web app knows who is signed in beyond their email: the header on the home page shows the user's avatar and display name and links to `/profile`.
**Affects:** frontend
**Tasks:**

- [ ] Extend `src/lib/api.ts` with `getProfile`, `updateProfile`, `changePassword`, `uploadAvatar` (XHR with progress, as `uploadMeetingRecording` does), `deleteAvatar` and `getAvatarUrl` (token as `?token=` plus an `avatarUpdatedAt`-derived cache-busting param)
- [ ] Extend `src/lib/auth.ts` / `useAuthenticatedUser` so pages receive the fetched profile (name + avatar presence) alongside the JWT-decoded email, and expose a way to swap in a newly issued token without a re-login; the JWT-decoded email stays the immediate value so the header renders before `GET /users/me` resolves
- [ ] Add `components/profile/UserAvatar.tsx`: the avatar image when present, initials derived from name (falling back to email) when not, in the header and profile-page sizes
- [ ] Update `AppHeader` to show `UserAvatar` + display name (falling back to email), both linking to `/profile`, keeping the "Sign out" button in place and still rendering when no user is passed
- [ ] Pass the loaded profile from the home page (`/`) into `AppHeader`

**Done when:** `pnpm lint:web` and `pnpm build:web` pass, and a Playwright MCP check of `/` shows the avatar and name for a user who has them, initials + email for a user who has neither, and no empty flash before the profile request resolves.

### Phase 6: Profile page

**Goal:** `/profile` exists as a protected read-only page showing the user's identity and account details.
**Affects:** frontend
**Tasks:**

- [ ] Add the `/profile` route as a client component using `useAuthenticatedUser` (redirect to `/login` without a valid token) with a spinner while the profile loads and an inline error on `ApiError`
- [ ] Render `AppHeader` plus the profile card: `UserAvatar` (or initials), display name (or email when unset), email and registration date formatted via `src/lib/format.ts`

**Done when:** `pnpm lint:web` and `pnpm build:web` pass, and a Playwright MCP check confirms `/profile` shows avatar/name/email/registration date, that clicking the header avatar navigates there, and that opening `/profile` without a token redirects to `/login`.

### Phase 7: Profile editing — display name & password

**Goal:** `/profile/edit` exists and a user can change their display name and their password without losing the session.
**Affects:** frontend
**Tasks:**

- [ ] Add the `/profile/edit` route as a protected client component (same auth/loading/error handling as `/profile`) laid out as independently submitted sections, and add the "Edit profile" button on `/profile` linking to it
- [ ] Build the profile section: a "Display name" input pre-filled from the loaded profile, a Save button disabled while nothing has changed, a success message on save, and an inline error on `ApiError`
- [ ] Propagate a saved name so the header and `/profile` show it without a manual page reload
- [ ] Build the password section: "Current password", "New password" and "Confirm new password" inputs with show/hide toggles reusing `EyeIcon`/`EyeOffIcon`, client-side match and minimum-length checks that block the request, and a wrong-current-password error rendered inline on that field
- [ ] Store the `accessToken` returned by a successful password change so the session continues uninterrupted

**Done when:** `pnpm lint:web` and `pnpm build:web` pass, and a Playwright MCP check confirms: a saved name appears in the header and on `/profile` without a reload; clearing the name falls back to the email; mismatched new-password fields show a client-side error and send no request; a successful password change is followed by `/` loading meetings without a redirect to `/login`.

### Phase 8: Profile editing — avatar

**Goal:** A user can upload, replace and remove their avatar from `/profile/edit`, with the change visible everywhere immediately.
**Affects:** frontend
**Tasks:**

- [ ] Build the avatar section on `/profile/edit`: current avatar or initials placeholder, a file picker showing a local preview before upload, and upload progress
- [ ] Add client-side type and size validation that blocks the request and shows an inline error naming the limit
- [ ] Add "Remove avatar" with confirmation in a HeroUI Modal (not `window.confirm`)
- [ ] Refresh the profile after upload or removal so the header and `/profile` show the new state without a manual reload, with the cache-busting param ensuring a replaced avatar is never served stale
- [ ] Update `apps/web/CLAUDE.md` and the root `CLAUDE.md`/`README.md` for the new routes and components

**Done when:** `pnpm lint:web` and `pnpm build:web` pass, and a Playwright MCP check confirms: a preview appears before upload; the uploaded avatar appears in the header and on `/profile` without a reload, including immediately after replacing an existing one; a disallowed type or oversized file shows an inline error and sends no request; a confirmed removal restores the initials placeholder everywhere.
