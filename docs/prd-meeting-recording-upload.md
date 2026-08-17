# PRD: Meeting Recording File Upload

**Date**: 2026-08-17
**Status**: Draft

## Goal

Let a meeting owner attach a recording file (video/audio) to a meeting, stored on the server with a processing lifecycle status. This is the foundation for later iterations (transcription, AI summaries): without reliable storage and file metadata there is nothing to process.

## Scenario

- User opens `/` and presses "Upload" in a meeting row → a file-picker modal opens without leaving the list
- User picks a file of an allowed type and size and confirms → upload progress is shown as a percentage; on completion the modal closes and the meeting row shows an `uploaded` status badge
- User picks a file of a disallowed type or above the size limit → the upload never starts and the modal shows an error message naming the limit
- User clicks a meeting row → `/meetings/{id}` opens with the meeting details (title, date, participants) and the recording block
- User on `/meetings/{id}` sees the recording block with filename, size, upload date and status → can play the file in the embedded player
- User on `/meetings/{id}` opens a meeting with no recording → sees the upload area (drag & drop + file picker) instead of the recording block
- User uploads a new file to a meeting that already has a recording → the previous recording is replaced and the old file is deleted from disk
- User deletes the recording from a meeting → the recording block is replaced by the upload area and the file is deleted from disk
- User tries to open `/meetings/{id}` of someone else's meeting → gets a 404 and a "meeting not found" message
- User loses connectivity mid-upload → the upload is marked failed, no recording row is created, the meeting stays without a file, and a retry is available

## In scope

**Data (Prisma)**

- New `MeetingRecording` model (`@@map("meeting_recordings")`): `id`, `meetingId` (FK to `Meeting`, `onDelete: Cascade`, `@unique` — one recording per meeting), `originalFilename`, `storagePath`, `mimeType`, `sizeBytes` (`BigInt`), `status`, `createdAt`, `updatedAt`
- `RecordingStatus` enum: `UPLOADED | PROCESSING | READY | FAILED`. In this iteration the API only ever sets `UPLOADED`; the other values exist in the schema and render correctly in the UI, but nothing assigns them
- Migration under `apps/api/prisma/migrations/`

**API (`apps/api`, `meetings` module)**

- `POST /meetings/:id/recording` → 201, `multipart/form-data`, a single file field `file`. Validates meeting ownership, MIME type and size, streams the file to disk, creates/replaces the `MeetingRecording`, returns the recording metadata
- `GET /meetings/:id/recording/content` → 200, streams the file content with correct `Content-Type`, `Content-Length` and HTTP Range support (needed for seeking in the player); 404 when there is no recording
- `DELETE /meetings/:id/recording` → 204, removes the database row and the file from disk; 404 when there is no recording
- `GET /meetings/:id` gains a `recording` field (metadata or `null`); `GET /meetings` gains a boolean `hasRecording` for the list badge
- CQRS per the existing convention: `UploadRecordingCommand`/`DeleteRecordingCommand` + handlers, `GetRecordingQuery` + handler, `RecordingsRepository` declared inside `MeetingsModule`
- `StorageService` — a provider exposing `save`/`createReadStream`/`delete`/`exists`, with a single local-filesystem implementation. The root path comes from the `UPLOADS_DIR` env var; files are stored as `{UPLOADS_DIR}/{meetingId}/{uuid}{ext}`, with the original filename kept only in the database
- All three routes are protected by `JwtAuthGuard`; a meeting owned by someone else or a non-existent one → 404 (ownership never leaks through the status code)
- Error codes: 400 (no file / malformed multipart), 404 (meeting or recording not found), 413 (size exceeded), 415 (disallowed MIME type)
- Env vars: `UPLOADS_DIR`, `MAX_UPLOAD_SIZE_BYTES`, `ALLOWED_RECORDING_MIME_TYPES` — documented in `apps/api/.env.example`

**Web (`apps/web`)**

- New `/meetings/[id]` route — a client component: `AppHeader`, the meeting card (title, date, participants) and the recording block; a spinner while data loads, an inline error on `ApiError`, a redirect to `/login` without a valid token
- `components/meetings/RecordingUploader.tsx` — the upload area: file picking via button and drag & drop, client-side type/size validation before sending, a progress indicator, an error message, and a "Cancel" button during upload
- `components/meetings/RecordingCard.tsx` — the existing-recording block: filename, human-readable size, upload date, status badge, a `<video>` player, and "Replace" / "Delete" buttons (deletion confirmed in a HeroUI Modal, not via `window.confirm`)
- `components/meetings/UploadRecordingModal.tsx` — a HeroUI Modal wrapping the same `RecordingUploader`, opened from a meeting list row
- `MeetingRow` gains: navigation to `/meetings/{id}`, a recording presence/status badge, and an "Upload" button (only when there is no recording), without breaking row-click navigation
- `src/lib/api.ts` gains `getMeeting`, `uploadMeetingRecording` (with a progress callback), `deleteMeetingRecording`, `getRecordingContentUrl`; all sending `Authorization: Bearer`
- Upload progress requires `XMLHttpRequest` (`fetch` exposes no upload progress) — this one method in `api.ts` deliberately departs from the shared `fetch` wrapper while keeping the same `ApiError` handling

**Documentation**

- Update `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, the root `CLAUDE.md`/`README.md`, and `.env.example` in the same change

## Out of scope

- Any actual processing of the file: transcription, diarization, AI summaries, extracting technical metadata via ffmpeg/ffprobe (duration, codec, resolution). The `PROCESSING`/`READY`/`FAILED` statuses are placeholders that nothing sets
- Job queues and workers (BullMQ, Redis, etc.)
- S3/MinIO or any external object storage; presigned URLs
- Chunked and resumable uploads, resuming after a connection drop
- Multiple files per meeting, recording versioning
- Transcoding, thumbnail/preview generation, audio-track extraction
- Recording access for meeting `participants` — owner only in this iteration
- A dedicated download button (the player and its native menu are enough)
- Antivirus scanning of uploaded files
- Server-side authorization via middleware/SSR — the current client-side token check stays
- Per-user quotas, scheduled cleanup of orphaned files

## Technical constraints

- **One process, one disk.** The local filesystem means the API cannot be scaled horizontally without a shared volume, and files do not survive container recreation without an external volume. A deliberate trade-off for this iteration; `StorageService` isolates the piece that has to be swapped when moving to S3
- `uploads/` (the default `UPLOADS_DIR` value) must be added to `.gitignore` and `.dockerignore`
- NestJS uploads require `@nestjs/platform-express` + `multer` (`FileInterceptor`). The file must be streamed to disk (`diskStorage`) rather than buffered in memory — otherwise a large file exhausts process memory
- The size limit is enforced in two places: `multer` (`limits.fileSize`) and a client-side check before sending. The client check is UX; the server one is the source of truth
- The MIME type in the multipart body comes from the client and is not trustworthy. It is checked against a MIME allowlist plus the file extension; deep content inspection (magic bytes) is out of scope, but the allowed types must be an explicit list, not a `video/*` wildcard
- `sizeBytes` as a Prisma `BigInt` is not serializable by `JSON.stringify` by default — it must be converted to a `string` or `number` at the API boundary
- CORS in `src/main.ts` is restricted to `WEB_URL`; uploads go to the same origin as every other request and need no extra configuration, but `Content-Length`/Range responses must be served without breaking the current CORS setup
- Browser upload progress is unreachable via `fetch` — it requires `XMLHttpRequest`, which diverges from the current style of `src/lib/api.ts`
- A `<video>` player cannot send an `Authorization` header with its `src` — this needs an API-level answer: either a short-lived signed token in a query parameter of the content route, or a cookie. The implementation choice is up to the implementer, but the content route must not become public
- No transactionality between the database and the filesystem: when replacing a recording, the file and the row do not change atomically. The order of operations must guarantee no reference to a missing file ever exists (write the new file, then update the database, then delete the old file)
- The Next.js production build must pass `pnpm build`; the pre-commit hook runs `pnpm lint && pnpm test`
- New API e2e tests require `docker compose up -d postgres` to be running and execute serially (`maxWorkers: 1`); they must clean up the files they create
- Per `apps/web/CLAUDE.md`, no UI change counts as done without verification via the `ui-ux-pro-max` skill and Playwright MCP
- Design: HeroUI v3 (compound composition, `onPress`), 44px mobile / 40px desktop touch targets, WCAG AA contrast

## Acceptance criteria

- [ ] `POST /meetings/:id/recording` with a valid JWT and an allowed file type returns 201 and the recording metadata; the file exists on disk at `storagePath` and a row with `status = UPLOADED` appears in `meeting_recordings`
- [ ] The same request without an `Authorization` header returns 401
- [ ] The same request against another user's meeting returns 404 and no file is written to disk
- [ ] Uploading a file whose MIME type is not on the allowlist returns 415 and no file is written to disk
- [ ] Uploading a file larger than `MAX_UPLOAD_SIZE_BYTES` returns 413 and leaves no partially written file on disk
- [ ] A request without the `file` field returns 400
- [ ] Re-uploading to the same meeting returns 201, the database still holds exactly one row for that meeting, and only the new file remains on disk
- [ ] `GET /meetings/:id/recording/content` returns bytes identical to the uploaded file (matching checksum) with the correct `Content-Type`, and responds 206 to a request carrying a `Range` header
- [ ] `DELETE /meetings/:id/recording` returns 204; a repeat `DELETE` returns 404; the file is gone from disk
- [ ] `GET /meetings/:id` returns `recording: null` for a meeting without a file and the metadata object after an upload; `GET /meetings` returns `hasRecording: true` for that meeting
- [ ] Deleting a meeting (or its owning user) cascades to the `meeting_recordings` row
- [ ] The e2e test `test/meetings-recording.e2e-spec.ts` covers upload → get content → delete plus every error code above; `pnpm test:e2e` passes end to end
- [ ] `pnpm lint`, `pnpm test` and `pnpm build` pass without errors
- [ ] On `/`, clicking a meeting row opens `/meetings/{id}`; the row's "Upload" button opens the modal without triggering navigation
- [ ] `/meetings/{id}` redirects to `/login` without a valid token; for another user's id it shows an error message rather than a blank page or an unhandled exception
- [ ] On `/meetings/{id}`, a meeting without a recording shows the upload area; dropping a file onto it starts the same upload as the file-picker button
- [ ] During upload a percentage progress indicator is visible and climbs to 100%, alongside a cancel button that aborts the request
- [ ] After a successful upload the recording block appears without a page reload, showing filename, human-readable size, date and status badge
- [ ] The player in the recording block plays the uploaded file and allows seeking
- [ ] Picking a file of a disallowed type or size shows an error in the UI before any request is sent; the message names the specific limit
- [ ] "Delete" asks for confirmation in a HeroUI Modal (not `window.confirm`); after confirming, the recording block is replaced by the upload area
- [ ] An API error (e.g. a server-side 413) is shown inline using the `ApiError` message rather than failing silently
- [ ] UI changes are verified with the `ui-ux-pro-max` skill and a Playwright MCP run; the browser console shows no errors
- [ ] `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, the root `CLAUDE.md`, `README.md` and `apps/api/.env.example` document the new routes, model, components and env vars
- [ ] `uploads/` is added to `.gitignore`
