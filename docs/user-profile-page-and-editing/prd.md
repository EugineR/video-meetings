# PRD: User Profile Page and Profile Editing

**Date**: 2026-08-18
**Status**: Draft

## Goal

Give a signed-in user an identity beyond their email: a profile page showing their name, avatar and account details, plus an edit page where they can change their display name, upload an avatar and change their password. The avatar and name then represent the user across the app — starting with the app header on the home page, which today shows only a raw email address.

## Scenario

- User clicks their avatar/name in the app header → `/profile` opens with their avatar, display name, email and registration date
- User presses "Edit profile" on `/profile` → `/profile/edit` opens with the profile form pre-filled with the current name
- User edits the display name and saves → a success message appears, the header and `/profile` show the new name immediately
- User clears the display name and saves → the name is unset and the app falls back to showing their email everywhere
- User picks an image file in the avatar area of `/profile/edit` → a local preview is shown before upload; on confirm the avatar is uploaded and appears in the header and on `/profile` without a page reload
- User picks a file of a disallowed type or above the size limit → the upload never starts and an inline error naming the limit is shown
- User uploads a new avatar when one already exists → the previous avatar is replaced and the old file is deleted from disk
- User presses "Remove avatar" and confirms → the avatar is deleted from disk and DB, and initials-based placeholders appear everywhere instead
- User fills the password form (current password, new password, confirm new password) and submits → a success message appears, the stored access token is replaced with a freshly issued one, and the user stays signed in
- User submits the password form with a wrong current password → an inline error on the "current password" field, the password is not changed
- User submits the password form where the new password and its confirmation differ → a client-side validation error, no request is sent
- User without a valid token opens `/profile` or `/profile/edit` → is redirected to `/login`, like every other protected page
- User with no avatar and no name opens the app → the header shows initials derived from their email plus the email itself, as today

## In scope

**Data (Prisma)**

- `User` gains `name String?` — optional display name, no uniqueness constraint
- New `UserAvatar` model (`@@map("user_avatars")`): `id`, `userId` (FK to `User`, `onDelete: Cascade`, `@unique` — one avatar per user), `originalFilename`, `storagePath`, `mimeType`, `sizeBytes` (`BigInt`), `createdAt`, `updatedAt`. Modelled after the existing `MeetingRecording`
- Migration under `apps/api/prisma/migrations/` — additive only, no backfill needed

**API (`apps/api`, new `users` controller inside the existing `UsersModule`)**

- `GET /users/me` → 200, returns `{ id, email, name, createdAt, hasAvatar, avatarUpdatedAt }`. The single source of truth for the profile — `name` cannot be read from the JWT, which only carries `sub` and `email`
- `PATCH /users/me` → 200, body `{ name?: string | null }`, returns the same shape as `GET /users/me`. `name` is trimmed; an empty string is stored as `null`; max length 100
- `POST /users/me/password` → 200, body `{ currentPassword, newPassword }`, returns `{ accessToken }` — a freshly signed token so the client can keep the session alive. Verifies `currentPassword` with bcrypt, rejects when the new password equals the current one, and hashes with the same `PASSWORD_SALT_ROUNDS` used at registration
- `POST /users/me/avatar` → 201, `multipart/form-data`, single file field `file`. Validates MIME type and size, writes the file, creates or replaces the `UserAvatar` row, deletes the previous file from disk, returns the avatar metadata
- `GET /users/me/avatar` → 200, streams the image with the correct `Content-Type` and `Content-Length`; 404 when there is no avatar. Protected like every other route and decorated with `@AllowQueryToken()` so an `<img src>` can authenticate via `?token=` (the same mechanism the recording player already uses)
- `DELETE /users/me/avatar` → 204, removes the row and the file from disk; 404 when there is no avatar
- CQRS per the existing convention: `UpdateProfileCommand`, `ChangePasswordCommand`, `UploadAvatarCommand`, `DeleteAvatarCommand` + handlers; `GetProfileQuery`, `GetAvatarQuery` + handlers; a `UserAvatarsRepository` declared inside `UsersModule`; `UsersRepository` gains `findById`, `updateName`, `updatePassword`
- All routes are protected by `JwtAuthGuard` and operate strictly on `user.sub` from the token — no route takes a user id from the URL or body
- Error codes: 400 (validation, wrong current password, no file), 401 (no/expired token), 404 (no avatar), 413 (size exceeded), 415 (disallowed MIME type)
- Env vars: `MAX_AVATAR_SIZE_BYTES` (default 5 MB), `ALLOWED_AVATAR_MIME_TYPES` (`image/jpeg,image/png,image/webp`) — documented in `apps/api/.env.example` and the root `.env.example`
- `StorageService` is extended to serve non-meeting files: avatars are stored at `{UPLOADS_DIR}/avatars/{userId}/{uuid}{ext}`. The current `resolveMeetingDir` UUID guard is generalised so the same path-traversal protection covers the user id

**Web (`apps/web`)**

- New `/profile` route (client component): `AppHeader`, an avatar (or initials placeholder), display name, email, registration date, and an "Edit profile" button linking to `/profile/edit`
- New `/profile/edit` route (client component) with three independent, separately submitted sections:
  - **Avatar** — current avatar or placeholder, a file picker with local preview before upload, "Upload"/"Remove" actions (removal confirmed in a HeroUI Modal, not `window.confirm`), client-side type/size validation, upload progress, and an inline error area
  - **Profile** — a "Display name" text input with a Save button, disabled while nothing has changed
  - **Password** — "Current password", "New password", "Confirm new password" inputs with show/hide toggles (reusing the existing `EyeIcon`/`EyeOffIcon`), client-side match and minimum-length checks, and a Save button. On success the returned token replaces the stored one
- New `components/profile/UserAvatar.tsx` — renders the avatar image when present and initials (from name, falling back to email) when not, in the sizes used by the header and the profile page
- `AppHeader` gains an avatar + display name (falling back to email), both clickable and linking to `/profile`; the existing "Sign out" button stays where it is. The header keeps working on pages that pass no user
- `src/lib/api.ts` gains `getProfile`, `updateProfile`, `changePassword`, `uploadAvatar`, `deleteAvatar`, `getAvatarUrl`; `getAvatarUrl` includes an `avatarUpdatedAt`-derived cache-busting query param so a replaced avatar is not served from the browser cache
- `src/lib/auth.ts` / `useAuthenticatedUser` are extended so pages get the profile (name + avatar presence), not just the JWT-decoded email, and so a newly issued token from the password change is stored without a re-login
- The home page (`/`) passes the loaded profile to `AppHeader`, so the avatar and name appear there

**Documentation**

- Update `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, the root `CLAUDE.md`/`README.md`, and both `.env.example` files in the same change

## Out of scope

- Changing the email address, and any email verification / confirmation flow
- Password reset for a user who has forgotten their password ("forgot password" link, reset tokens, outbound email)
- Invalidating previously issued JWTs on password change (would require a `tokenVersion` column or a session store); the old token stays valid until its natural expiry
- Two-factor authentication, active-session lists, sign-out-everywhere
- Account deletion / deactivation
- A "Name" field on the registration form — the name is set only from the profile page
- Server-side image processing: resizing, cropping, thumbnail generation, EXIF stripping, format conversion. The file is stored exactly as uploaded
- An in-browser crop/zoom editor for the avatar
- Any public or cross-user profile view (`/users/{id}`), avatars for meeting participants, or avatars anywhere outside the header and the profile pages
- S3/MinIO or any external object storage; presigned URLs
- Gravatar or other external avatar providers
- Additional profile fields (bio, timezone, locale, job title, notification settings)
- Server-side auth via middleware/SSR — the current client-side token check stays
- Rate limiting on the password-change endpoint

## Technical constraints

- **The JWT does not carry the display name.** `JwtPayload` is `{ sub, email }`, and `getStoredUser()` decodes it locally without a network call. Name and avatar therefore require a `GET /users/me` request, which introduces a loading state into the header that does not exist today; the header must render acceptably (email + initials) before that request resolves rather than flashing empty
- **Password change and session.** JWTs are stateless and there is no refresh-token or session store, so the endpoint returns a newly signed token that the client swaps into `localStorage`. Any other copy of the old token stays usable until it expires — an accepted trade-off for this iteration
- **The avatar `<img>` cannot send an `Authorization` header.** The same `@AllowQueryToken()` + `?token=` mechanism the recording player uses is reused, which means the access token appears in an image URL (and thus in browser history and server logs). Acceptable only because the pattern is already in use for recordings
- **Browser caching of a replaced avatar.** The avatar URL is stable per user, so replacing the image would otherwise serve a stale cached copy. The URL must carry an `avatarUpdatedAt`-derived query param, and/or the endpoint must send `Cache-Control: no-cache`
- `StorageService` is currently meeting-specific: `resolveMeetingDir` hard-rejects anything that is not a UUID and `delete` prunes the parent directory. Reusing it for avatars requires generalising the path resolution while keeping the traversal guard intact — the id comes from the token, but the guard must not be weakened
- Local-disk storage carries the same limits as recordings: the API cannot be scaled horizontally without a shared volume, and avatars do not survive container recreation without an external volume
- The MIME type in the multipart body comes from the client and is not trustworthy. It is checked against an explicit allowlist plus the file extension (no `image/*` wildcard); magic-byte inspection is out of scope. An uploaded file is served back to browsers, so the response `Content-Type` must come from the validated allowlist value, never from raw client input
- `sizeBytes` as a Prisma `BigInt` is not serializable by `JSON.stringify` — it must be converted to a `string` at the API boundary, as `MeetingRecording` already does
- The size limit is enforced both in `multer` (`limits.fileSize`) and client-side before sending; the client check is UX only, the server one is the source of truth
- `apps/api` has a test suite and a `pre-commit` hook running `pnpm lint && pnpm test` — new validation logic (password rules, avatar file filter) must ship with unit tests in the existing style
- HeroUI v3 + Tailwind v4 are the only UI primitives; no new frontend dependency for the avatar UI

## Acceptance criteria

- [ ] `prisma migrate` applies cleanly on an existing database: `users.name` is nullable and existing rows are untouched; the `user_avatars` table exists with a unique `userId` and cascade delete
- [ ] `GET /users/me` returns `id`, `email`, `name`, `createdAt`, `hasAvatar` and `avatarUpdatedAt` for the token's own user, and 401 without a valid token
- [ ] `PATCH /users/me` with `{ "name": "Jane Doe" }` returns the updated profile, and a follow-up `GET /users/me` returns the same name
- [ ] `PATCH /users/me` with `{ "name": "   " }` stores `null`, and the UI falls back to the email
- [ ] `PATCH /users/me` with a name longer than 100 characters returns 400 and does not change the stored name
- [ ] `POST /users/me/password` with the correct current password returns a new `accessToken`; that token authenticates `GET /users/me`, and a subsequent `POST /auth/login` succeeds with the new password and fails with the old one
- [ ] `POST /users/me/password` with a wrong current password returns 400 and leaves the stored hash unchanged (login with the original password still works)
- [ ] `POST /users/me/avatar` with a valid PNG/JPEG/WebP returns 201 with the avatar metadata; `GET /users/me/avatar` then returns the exact bytes that were uploaded with the matching `Content-Type`
- [ ] Uploading a second avatar replaces the first: `GET /users/me/avatar` serves the new image and the previous file no longer exists under `{UPLOADS_DIR}/avatars/{userId}/`
- [ ] `POST /users/me/avatar` with a `.txt` file, or a file renamed to `.png` but sent with a disallowed MIME type, returns 415 and writes nothing to disk
- [ ] `POST /users/me/avatar` with a file above `MAX_AVATAR_SIZE_BYTES` returns 413 and writes nothing to disk
- [ ] `DELETE /users/me/avatar` returns 204, the file is gone from disk, `GET /users/me/avatar` afterwards returns 404, and `GET /users/me` reports `hasAvatar: false`
- [ ] Every `/users/me*` route returns 401 without a token, and no route accepts a user id from the URL or body — a token for user A can never read or modify user B's profile
- [ ] Opening `/profile` or `/profile/edit` without a valid token redirects to `/login`
- [ ] `/profile` displays the avatar (or initials), display name (or email when unset), email and registration date
- [ ] Saving a new display name on `/profile/edit` shows a success message, and the name is visible in the app header and on `/profile` without a manual page reload
- [ ] Selecting an image on `/profile/edit` shows a local preview before upload; after confirming, the new avatar appears in the header and on `/profile` without a manual page reload — including immediately after replacing an existing one (no stale cached image)
- [ ] Selecting a disallowed file type or an oversized file on `/profile/edit` shows an inline error naming the limit and sends no request
- [ ] "Remove avatar" asks for confirmation in a HeroUI Modal, and after confirming the initials placeholder appears in the header and on `/profile`
- [ ] Submitting the password form with mismatched new-password fields shows a client-side error and sends no request
- [ ] Submitting the password form successfully keeps the user signed in: navigating to `/` afterwards loads meetings without a redirect to `/login`
- [ ] The home page header shows the user's avatar and display name, and clicking either navigates to `/profile`; for a user with neither, it shows initials plus the email as before
- [ ] `pnpm lint` and `pnpm test` pass, with new unit tests covering the avatar file filter and the password-change validation rules
- [ ] `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, root `CLAUDE.md`/`README.md` and both `.env.example` files describe the new routes, model, components and env vars
