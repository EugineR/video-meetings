# Plan: Meeting recording transcription

**PRD:** docs/meeting-recording-transcription/prd.md
**Date:** 2026-08-25

## Implementation Phases

### Phase 1: Data model & mp3 upload support

**Goal:** A meeting recording upload accepts mp3 alongside the existing video types, and the database can hold a transcript per recording, independent of any transcription logic.
**Affects:** backend, database
**Tasks:**

- [ ] Add a nullable `transcriptText` column to the `MeetingRecording` model in `apps/api/prisma/schema.prisma`; create the migration
- [ ] Add `audio/mpeg` → `.mp3` to the MIME-type/extension map in `recording-file-filter.ts`
- [ ] Add `audio/mpeg` to the default `ALLOWED_RECORDING_MIME_TYPES` in `apps/api/.env.example` (and local `.env`)
- [ ] `RecordingsRepository.createOrReplace` resets `transcriptText` to `null` on both create and replace, so a new or replacing upload always starts with no transcript
- [ ] Extend `recording-file-filter.spec.ts` for the mp3 case and the recording upload e2e spec to assert an mp3 upload succeeds (201) with a stored row of `status: UPLOADED`, `transcriptText: null`

**Done when:** `pnpm prisma:migrate` applies the new migration, an mp3 file uploads successfully through `POST /meetings/:id/recording`, and `pnpm test` / `pnpm test:e2e` pass.

### Phase 2: Local Whisper transcription pipeline

**Goal:** Every successful recording upload is transcribed automatically in the background by a local Whisper `base` model, with the recording's status reflecting progress.
**Affects:** backend
**Tasks:**

- [ ] Implement a `TranscriptionService` (HTTP-agnostic, following the `StorageService` pattern) that runs the local Whisper `base` model against a recording file path and returns the transcript text, throwing on failure
- [ ] Trigger transcription from `UploadRecordingHandler` right after a successful upload, asynchronously and without blocking the HTTP response: set `status: PROCESSING` before starting, then persist `status: READY` with `transcriptText` on success, or `status: FAILED` on error
- [ ] Guard the async completion so it never overwrites a recording that has since been replaced or deleted (e.g. condition the persisted update on the recording still being the current one for its meeting)
- [ ] Add whatever env var(s) the local Whisper invocation needs to `apps/api/.env.example`
- [ ] Unit tests for `TranscriptionService` and the upload handler's status-transition logic, stubbing the actual Whisper process so tests don't require a local Whisper install

**Done when:** uploading a recording drives its status `UPLOADED` → `PROCESSING` → `READY` (with `transcriptText` populated) or `FAILED`, verified by unit tests with the Whisper invocation stubbed, and `pnpm test` passes.

### Phase 3: Replace/delete correctness, API exposure & docs

**Goal:** The full backend feature is complete and independently verifiable end to end: transcript and status are visible through the existing read routes, and stay consistent across replace and delete.
**Affects:** backend
**Tasks:**

- [ ] e2e test: `GET /meetings/:id` and `GET /meetings/:id/recording` responses include `status` and `transcriptText`
- [ ] e2e test: deleting a meeting's recording also removes its transcript
- [ ] e2e test: replacing a meeting's recording clears the previous transcript/status and restarts transcription for the new file
- [ ] Update `apps/api/CLAUDE.md` and `docs/architecture/api.md` for the new column, service and env var(s)

**Done when:** `pnpm test:e2e`, `pnpm lint` and `pnpm build` pass for `apps/api`, and every backend acceptance criterion in the PRD is covered by a passing test.

### Phase 4: Meeting page transcription status & transcript display

**Goal:** A user viewing a meeting with a recording sees its transcription status update automatically, and reads the transcript once it's ready.
**Affects:** frontend
**Tasks:**

- [ ] `src/lib/api.ts`: add `transcriptText: string | null` to the `Recording` interface
- [ ] Meeting page/`RecordingCard`: show the transcript text once `status` is `READY`, a failure notice when `FAILED`, and no transcript while `UPLOADED`/`PROCESSING`
- [ ] While `status` is `UPLOADED` or `PROCESSING`, refetch the meeting/recording so the page updates to `READY`/`FAILED` without a manual reload
- [ ] Verify with the `ui-ux-pro-max` skill and a Playwright MCP run (upload a recording, watch status progress to done, confirm transcript renders, no console errors)

**Done when:** opening `/meetings/{id}` for a meeting with a recording shows its live transcription status, and the transcript text appears once done, without a manual page reload.

### Phase 5: mp3 upload UI & docs

**Goal:** A user can upload an mp3 recording from the web app, see it play back appropriately, and all project docs describe the finished feature.
**Affects:** frontend
**Tasks:**

- [ ] `RecordingUploader.tsx`: add `audio/mpeg` to `ALLOWED_MIME_TYPES`, mirroring the API allowlist
- [ ] `RecordingCard.tsx`: render an `<audio>` element instead of `<video>` when the recording's `mimeType` is `audio/mpeg`
- [ ] Update `apps/web/CLAUDE.md`, the root `CLAUDE.md` and root `README.md` for the new MIME type, transcription flow and any new env var(s)
- [ ] Verify the full mp3 upload → transcription status → transcript flow with the `ui-ux-pro-max` skill and a Playwright MCP run, checking the browser console for errors

**Done when:** uploading an mp3 recording through the web app succeeds, plays back via an audio player, and its transcription status and transcript behave exactly as they do for a video recording; `pnpm lint` / `pnpm build` pass for `apps/web`.
