# Plan: Meeting Recording File Upload

**PRD:** docs/meeting-recording-upload/prd.md
**Date:** 2026-08-17

## Implementation Phases

### Phase 1: Data model & storage foundation

**Goal:** The database can persist recording metadata and the API can write/read/delete files on local disk, independent of any HTTP route.
**Affects:** backend, database
**Tasks:**

- [ ] Add the `MeetingRecording` model (`@@map("meeting_recordings")`: `id`, `meetingId` FK to `Meeting` with `onDelete: Cascade` and `@unique`, `originalFilename`, `storagePath`, `mimeType`, `sizeBytes` as `BigInt`, `status`, `createdAt`, `updatedAt`) and the `RecordingStatus` enum (`UPLOADED | PROCESSING | READY | FAILED`) to `apps/api/prisma/schema.prisma`; create the migration
- [ ] Add `UPLOADS_DIR`, `MAX_UPLOAD_SIZE_BYTES`, `ALLOWED_RECORDING_MIME_TYPES` to `apps/api/.env.example` (and local `.env`)
- [ ] Add `uploads/` (the default `UPLOADS_DIR`) to `.gitignore` and `.dockerignore`
- [ ] Implement `StorageService` (a Nest provider exposing `save`/`createReadStream`/`delete`/`exists`, single local-filesystem implementation, files stored at `{UPLOADS_DIR}/{meetingId}/{uuid}{ext}`)

**Done when:** `pnpm prisma:migrate` applies the new migration, `pnpm prisma:generate` and `pnpm build` succeed, and `StorageService` can save, stream-read and delete a file on local disk.

### Phase 2: Upload & delete recording API

**Goal:** A meeting owner can upload a recording (replacing any existing one) and delete it, entirely through the API.
**Affects:** backend
**Tasks:**

- [ ] Write `test/meetings-recording.e2e-spec.ts` up front (expected to fail red against the current codebase): upload happy path (201, file on disk, `UPLOADED` row), re-upload replace (single row, only new file on disk), delete (204, repeat delete 404), and error codes 401/404/413/415/400
- [ ] `RecordingsRepository` (create/replace, `findByMeetingId`, `delete`), declared inside `MeetingsModule`
- [ ] `UploadRecordingCommand` + handler: `FileInterceptor`/`diskStorage`, MIME-type + extension allowlist check (415), size limit via `multer` `limits.fileSize` (413), meeting-ownership check (404 for missing/foreign meetings), stream file to disk, then create/replace the `MeetingRecording` row — write new file → update DB → delete old file, so no reference to a missing file ever exists
- [ ] `DeleteRecordingCommand` + handler: ownership check (404), delete the DB row and the file from disk, 404 when there is no recording
- [ ] Wire `POST /meetings/:id/recording` and `DELETE /meetings/:id/recording` on `MeetingsController` behind `JwtAuthGuard`, returning 201/204; 400 when the `file` field is missing or the multipart body is malformed

**Done when:** the e2e spec written in the first task above now passes green (upload/delete cases and all listed error codes), and `pnpm lint` / `pnpm test` pass.

### Phase 3: Recording content streaming & meeting read integration

**Goal:** The full backend feature is complete and independently testable end to end (upload → stream content → delete), including the recording data on the existing meeting read endpoints.
**Affects:** backend
**Tasks:**

- [ ] Extend `test/meetings-recording.e2e-spec.ts` up front (expected to fail red): content streaming (checksum match, `Range` → 206), the `recording`/`hasRecording` fields on both read endpoints, and cascade delete of `meeting_recordings` when a meeting or its owning user is deleted
- [ ] `GetRecordingQuery` + handler and `GET /meetings/:id/recording/content` route: stream via `StorageService.createReadStream`, correct `Content-Type`/`Content-Length`, HTTP Range support (206), 404 when there is no recording
- [ ] Extend `GetMeetingByIdQuery`/handler so `GET /meetings/:id` returns a `recording` field (metadata, or `null`), serializing `sizeBytes` to a JSON-safe type
- [ ] Extend `GetMeetingsQuery`/handler so `GET /meetings` returns `hasRecording: boolean` per meeting
- [ ] Update `apps/api/CLAUDE.md` and `apps/api/.env.example` for the new routes, model and env vars

**Done when:** `test/meetings-recording.e2e-spec.ts` (written incrementally red-then-green across Phases 2–3) passes end to end (upload → get content → delete, plus every error code in the PRD's acceptance criteria), and `pnpm test:e2e`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.

### Phase 4: Meeting detail page & recording UI

**Goal:** Navigating directly to `/meetings/{id}` lets an owner view, play, upload and delete a recording, fully wired to the real API.
**Affects:** frontend
**Tasks:**

- [ ] `src/lib/api.ts`: add `getMeeting`, `uploadMeetingRecording` (XHR-based, with an upload-progress callback and cancel support), `deleteMeetingRecording`, `getRecordingContentUrl`, all attaching `Authorization: Bearer` and throwing `ApiError` on non-2xx
- [ ] `src/app/meetings/[id]/page.tsx`: client component rendering `AppHeader`, the meeting card (title, date, participants) and the recording block; spinner while loading, redirect to `/login` without a valid token, inline "meeting not found" message on a 404 `ApiError`
- [ ] `components/meetings/RecordingUploader.tsx`: file picker button + drag & drop, client-side type/size validation before sending (error names the specific limit), upload progress percentage, cancel button
- [ ] `components/meetings/RecordingCard.tsx`: filename, human-readable size, upload date, status badge, `<video>` player with seeking, "Replace"/"Delete" buttons, delete confirmed via a HeroUI Modal (not `window.confirm`)

**Done when:** opening `/meetings/{id}` for one's own meeting shows the upload area (no recording) or the recording block (existing recording); uploading shows live progress and the recording block appears without a page reload; delete asks for confirmation and reverts to the upload area; verified with the `ui-ux-pro-max` skill and a Playwright MCP run with no console errors.

### Phase 5: Meeting list integration & documentation

**Goal:** The full user-facing flow described in the PRD's scenario works starting from the home page list, and all project docs describe the finished feature.
**Affects:** frontend
**Tasks:**

- [ ] `components/meetings/UploadRecordingModal.tsx`: HeroUI Modal wrapping `RecordingUploader`, opened from a meeting list row
- [ ] `MeetingRow.tsx`: navigation to `/meetings/{id}` on row click, a recording presence/status badge, an "Upload" button shown only when there is no recording that opens the modal without triggering row navigation
- [ ] Update `apps/web/CLAUDE.md`, the root `CLAUDE.md` and root `README.md` for the new route, components and API wiring
- [ ] Verify the end-to-end flow (list → upload modal → detail page → replace/delete) with the `ui-ux-pro-max` skill and a Playwright MCP run, checking the browser console for errors

**Done when:** clicking a meeting row opens `/meetings/{id}`, its "Upload" button opens the modal without navigating, the row's badge reflects recording state after upload, every UI-facing acceptance criterion in the PRD passes, and `pnpm lint`/`pnpm build` pass for `apps/web`.
