# Plan: Meetings UX Improvements — Header Link, Create-Meeting Modal, Back Navigation, Multi-File Recordings

## Context

`docs/meetings-ux-header-modal-back-multifile/prd.md` bundles four usability fixes surfaced from design review: the header logo/title doesn't link home, there's no way to create a meeting by hand, the meeting detail page has no way back, and a meeting can only ever hold one recording file. The first three are small, independent UI fixes. The fourth is the substantial one: it requires reversing a deliberate design decision from two earlier features (`docs/meeting-recording-upload/prd.md` line 27/63 and `docs/meeting-recording-transcription/prd.md` lines 66-67 both explicitly scoped recordings to "one per meeting" and excluded multi-file support). This plan supersedes that decision — those two PRDs are left unedited as historical record; only living docs (`README.md`, both `CLAUDE.md`s, `docs/architecture/*`, `docs/testing/*`) get updated.

Two placement decisions were confirmed with the user before finalizing this plan:

- The "+ Create meeting" button lives in `page.tsx`'s own content area, **not** inside the shared `AppHeader` component (which also renders on `login`/`register`/`profile`/`profile/edit`/meeting-detail pages where the button doesn't belong).
- `RecordingCard`'s "Replace" button is **removed** entirely — a user who wants to replace a file deletes it and uploads a new one. Neither the PRD's scenarios nor the mockup mention per-file replace, only independent delete + add-another-file.

## Other locked-in design decisions

- **List-item shape:** `MeetingListItemResponse.hasRecording: boolean` → `recordingCount: number` (mirrored on the frontend). `MeetingRow` derives "has any" as `recordingCount > 0`.
- **New REST routes:** `POST /meetings/:id/recordings` (add a file), `GET /meetings/:id/recordings/:recordingId/content` (stream one file), `DELETE /meetings/:id/recordings/:recordingId` (delete one file). The recordings list itself is embedded in `GET /meetings/:id`'s response, not a separate route.
- **Migration:** dropping `@unique` from `MeetingRecording.meetingId` is additive/relaxing — no existing row becomes invalid, no data-loss risk.
- **`updateStatusIfCurrent` matching key** changes from `(meetingId, storagePath)` to `recordingId` alone — verified against the real code (`apps/api/src/meetings/recordings.repository.ts:58-68`): the current `storagePath` matching exists only because `createOrReplace` is an upsert that keeps the row's `id` stable across a replace. Once uploads become a plain `create` (permanent `id`, no upsert-in-place), `id` is simpler and sufficient. This changes a documented invariant in `apps/api/CLAUDE.md` — updated in Phase 9.

---

## Phase 1: Header logo/title as a link to `/`

**Files:** `apps/web/src/components/layout/AppHeader.tsx`

Wrap the existing logo block (`span` icon + `h1` "Video Meetings") in a HeroUI `Link` to `/`, following the exact pattern already used for the avatar/name `Link` in the same file (`<Link className="flex items-center gap-2 rounded-lg py-1" href="/profile">`). Must render unconditionally (not gated behind `email`) since `AppHeader` also renders on `login`/`register` with no props. No `AppHeaderProps` changes needed.

**Verify:** Playwright MCP — click the logo from `/`, `/meetings/{id}`, `/profile`, `/profile/edit`, `/login`, `/register`, confirm navigation to `/` each time, no console errors. Also run the `ui-ux-pro-max` skill check (hover/focus states look intentional now that it's interactive).

---

## Phase 2: Back button on the meeting detail page

**Files:**

- `apps/web/src/app/meetings/[id]/page.tsx`
- new: `apps/web/src/components/icons/ArrowLeftIcon.tsx` + export in `apps/web/src/components/icons/index.ts`

Add an `ArrowLeftIcon` (same inline-SVG pattern as `UploadIcon.tsx`/`TrashIcon.tsx`: `viewBox="0 0 24 24"`, `stroke="currentColor"`, `React.SVGProps<SVGSVGElement>` props). In `MeetingDetailPage`, add a `Button` (HeroUI, `variant="secondary"` or ghost-style) calling `router.back()` from `useRouter()` (`next/navigation` — not yet imported in this file). Place it top-left, above the meeting title `Card`, inside the same `max-w-2xl` content column. This is the first `router.back()` usage in the repo (existing precedent is `router.push`/`router.replace` only) — matches the PRD's explicit requirement for history-based navigation, not a hardcoded `router.push('/')`.

**Verify:** Playwright MCP — navigate to a meeting from `/`, click back, confirm return to `/`; also confirm it doesn't crash when the meeting page is opened via direct URL (no prior in-app history).

---

## Phase 3: Backend — multi-recording data model and API

### 3.1 Schema + migration

**Files:** `apps/api/prisma/schema.prisma`, new migration under `apps/api/prisma/migrations/`

- Remove `@unique` from `MeetingRecording.meetingId`.
- Change `Meeting.recording MeetingRecording?` → `Meeting.recordings MeetingRecording[]`.
- Run `pnpm --filter api prisma:migrate` to generate `YYYYMMDDHHMMSS_meeting_recordings_many_per_meeting/` (follows the existing naming convention, e.g. `20260825161058_add_transcript_text`) and regenerate the client.

### 3.2 `RecordingsRepository` rewrite

**File:** `apps/api/src/meetings/recordings.repository.ts` (current full content verified)

- `createOrReplace` (currently `prisma.meetingRecording.upsert({ where: { meetingId } })`) → plain `create(input): Promise<MeetingRecording>` doing `prisma.meetingRecording.create({ data: { meetingId, ...data } })`.
- `findByMeetingId` (currently `findUnique`) → `findMany({ where: { meetingId }, orderBy: { createdAt: 'asc' } })`, return type `Promise<MeetingRecording[]>`.
- Add `findById(meetingId: string, recordingId: string): Promise<MeetingRecording | null>` — `findFirst({ where: { id: recordingId, meetingId } })`, scoped by both ids so a recording id can't be read/streamed/deleted through a different meeting's URL.
- `updateStatusIfCurrent` — drop `meetingId`/`storagePath` params, take `(recordingId: string, data: UpdateRecordingStatusInput)`, use `updateMany({ where: { id: recordingId }, data })`. Rewrite the doc comment (lines 49-57) to explain matching by `id` is now sufficient since `create` always gets a fresh permanent id.
- `delete(meetingId)` (currently `delete({ where: { meetingId } })`) → `delete(meetingId: string, recordingId: string)`: `findFirst({ where: { id: recordingId, meetingId } })` then `delete({ where: { id: recordingId } })` if found (keep the P2025-catch → `null` convention), since the handler needs the found row's `storagePath` to delete the file afterward.

### 3.3 `MeetingsRepository` rewrite

**File:** `apps/api/src/meetings/meetings.repository.ts`

- Rename `MeetingWithRecording` → `MeetingWithRecordings = Meeting & { recordings: MeetingRecording[] }`.
- `findAllByOwner` / `findByIdAndOwnerWithRecording` (rename to `findByIdAndOwnerWithRecordings`): `include: { recording: true }` → `include: { recordings: { orderBy: { createdAt: 'asc' } } }`.
- `findByIdAndOwner` (lean check, used by upload/delete handlers) is unchanged.

### 3.4 Interfaces

**Files:** `apps/api/src/meetings/interfaces/meeting-detail-response.interface.ts`, `.../meeting-list-item-response.interface.ts`

- `MeetingDetailResponse = Meeting & { recordings: RecordingResponse[] }`; map via `meeting.recordings.map(toRecordingResponse)`.
- `MeetingListItemResponse = Meeting & { recordingCount: number }`; `recordingCount: recordings.length`.
- `RecordingResponse`/`RecordingContent` unchanged — already per-recording DTOs.

### 3.5 Commands/queries — add `recordingId`

**Files:**

- `commands/delete-recording.command.ts` — add `recordingId: string` (order: `meetingId, recordingId, ownerId`).
- `commands/handlers/delete-recording.handler.ts` — after the meeting ownership check, `recordingsRepository.delete(meetingId, recordingId)` (404 if `null`), then `storageService.delete(recording.storagePath)`.
- `queries/get-recording.query.ts` — add `recordingId: string` (order: `meetingId, recordingId, ownerId, rangeHeader?`).
- `queries/handlers/get-recording.handler.ts` — switch from `findByIdAndOwnerWithRecording` to lean `findByIdAndOwner` + `recordingsRepository.findById(meetingId, recordingId)`; 404 if either is missing.
- `commands/upload-recording.command.ts` — unchanged shape (`meetingId, ownerId, file`).

### 3.6 `UploadRecordingHandler` rewrite

**File:** `apps/api/src/meetings/commands/handlers/upload-recording.handler.ts` (current full content verified)

- `recordingsRepository.createOrReplace(...)` → `.create(...)`.
- `storageService.pruneMeetingDir(meetingId, recording.storagePath)` (line 56-59): the "keep" argument becomes a list of every current recording's `storagePath` for the meeting. After `create` commits, call `recordingsRepository.findByMeetingId(meetingId)` for the authoritative current set (same "read real state after the DB write commits" race-freedom as today), map to `storagePath[]`, pass to `pruneMeetingDir`.
- `transcribeInBackground(meetingId, storagePath)` (line 65, 83-92) → `transcribeInBackground(recording.id, storagePath)` — drop `meetingId`; `persistIfCurrent` calls `updateStatusIfCurrent(recordingId, data)`. Update the method's doc comment (line 77-82) to describe matching by `recordingId`.

### 3.7 `StorageService.pruneMeetingDir` rewrite

**File:** `apps/api/src/storage/storage.service.ts` (current full content verified)

- `pruneMeetingDir(meetingId: string, keepStoragePath: string)` (line 101-103) → `pruneMeetingDir(meetingId: string, keepStoragePaths: string[])`.
- Shared private `pruneDir(dir, keepStoragePath)` (line 114-131) → `pruneDir(dir, keepStoragePaths: string[])`, filter becomes `!keepStoragePaths.includes(entryPath)` instead of `!== keepStoragePath`.
- `pruneAvatarDir(userId, keepStoragePath)` (line 110-112) stays single-path externally — update its call site to `pruneDir(dir, [keepStoragePath])`.
- Update doc comments (line 93-100) to describe pruning against the current set of a meeting's recordings, not one just-written path.

### 3.8 Controller route changes

**File:** `apps/api/src/meetings/meetings.controller.ts`

- `POST /meetings/:id/recording` → `POST /meetings/:id/recordings` (dispatch unchanged).
- `GET /meetings/:id/recording/content` → `GET /meetings/:id/recordings/:recordingId/content`; add `@Param('recordingId')`; dispatch `new GetRecordingQuery(id, recordingId, user.sub, range)`. Keep `@AllowQueryToken()`.
- `DELETE /meetings/:id/recording` → `DELETE /meetings/:id/recordings/:recordingId`; add the param; dispatch `new DeleteRecordingCommand(id, recordingId, user.sub)`.
- `GET /meetings/:id` and `GET /meetings` routes unchanged; only their response shape changes (via 3.4).

### 3.9 Module wiring

**File:** `apps/api/src/meetings/meetings.module.ts` — no change needed; `MulterModule.registerAsync`'s `resolveDir` reads `req.params.id`, unaffected by the route tail changing from `/recording` to `/recordings`.

**Verify:** `pnpm --filter api build && pnpm --filter api lint`, then Phase 8's e2e coverage. Manually: upload two files to one meeting, stream each independently by its own `recordingId`, delete one and confirm the other survives on disk and in the DB.

---

## Phase 4: Backend — create-meeting endpoint (no code change)

`POST /meetings` and `CreateMeetingDto` (`title: string` non-empty, `date: string` ISO date, `participants: string[]` array of emails, all already validated via `class-validator`) already match the PRD's field list exactly. No backend change. One frontend implication: `participants` has no `@IsOptional()`, so the frontend must always send `participants: []` (not omit the field) when the user leaves that input blank.

---

## Phase 5: Frontend — `api.ts` changes

**File:** `apps/web/src/lib/api.ts`

- `MeetingDetail`: `recording: Recording | null` → `recordings: Recording[]`.
- `MeetingListItem`: `hasRecording: boolean` → `recordingCount: number`.
- New: `createMeeting(title: string, date: string, participants: string[]): Promise<Meeting>` → `postJson<Meeting>('/meetings', { title, date, participants })`, following the exact `registerUser`/`loginUser` pattern already in the file.
- `getRecordingContentUrl(meetingId: string, recordingId: string): string` — URL becomes `${API_URL}/meetings/${meetingId}/recordings/${recordingId}/content`.
- `uploadMeetingRecording(meetingId, file, opts)` — XHR target becomes `${API_URL}/meetings/${meetingId}/recordings`; keep the XHR/`AbortController`/progress-event implementation unchanged (do not switch to `fetch` — it can't report upload progress).
- `deleteMeetingRecording(meetingId: string, recordingId: string): Promise<void>` — target becomes `${API_URL}/meetings/${meetingId}/recordings/${recordingId}`.

**Note:** landing this phase alone will show type errors at every current call site (RecordingCard, MeetingRow, meeting detail page) until Phases 6-7 land — expected; verify `build`/`lint` only after 5-7 are all in.

---

## Phase 6: Frontend — create-meeting modal + home page wiring

**Files:**

- new: `apps/web/src/components/meetings/CreateMeetingModal.tsx`
- new: `apps/web/src/components/icons/PlusIcon.tsx` + export in `apps/web/src/components/icons/index.ts`
- `apps/web/src/app/page.tsx`

### `CreateMeetingModal.tsx`

Modeled on `UploadRecordingModal.tsx`'s structure (`Modal.Backdrop` → `Modal.Container` → `Modal.Dialog` → `Modal.CloseTrigger` + `Modal.Header`/`Modal.Heading` + `Modal.Body`), plus `Modal.Footer` with `<Button slot="close" variant="secondary">Cancel</Button>` (auto-closes) and `<Button isPending={...} type="submit">Create meeting</Button>` (pattern from `RecordingCard.tsx`'s delete-confirm modal).

Props: `{ isOpen, onOpenChange, onCreated: (meeting: Meeting) => void }` — no `meetingId`, this modal isn't scoped to an existing meeting.

Fields:

- `title` — required text field, inline validation error if empty.
- `date` — native `<input type="datetime-local">` (matches the mockup's `дд.мм.гггг, --:--` placeholder rendering); required; on submit convert via `new Date(value).toISOString()` before sending (`CreateMeetingDto.date` is `@IsDateString()`).
- `participants` — plain text `Input`, placeholder `"alice@example.com, bob@example.com"` per the mockup. On submit: split on `,`, `.trim()` each, filter empty strings → `[]` if blank (never `undefined`, per Phase 4's note).
- Submitting with missing title/date shows inline errors and does not call the API (explicit PRD acceptance criterion).
- On success: call `onCreated(meeting)`, then `onOpenChange(false)`. On failure: inline `ApiError` message, modal stays open.

### `page.tsx` wiring

- New "+ Create meeting" `Button` (with `PlusIcon`) rendered in `page.tsx`'s own content area, below `AppHeader` — **not** inside `AppHeader` itself (confirmed placement), positioned above the "Recent meetings"/"All meetings" cards.
- New state: `const [isCreateOpen, setIsCreateOpen] = useState(false)`.
- `handleMeetingCreated(meeting: Meeting)`: `setMeetings((current) => current ? [meeting, ...current] : [meeting])` — prepend, mirroring how `handleRecordingUploaded` already does a local-state patch instead of a refetch. Since "Recent meetings" is client-sorted by date descending, a newly created meeting surfaces there automatically only if its date is actually the most recent — that's correct behavior, not a special case.
- Render `<CreateMeetingModal isOpen={isCreateOpen} onOpenChange={setIsCreateOpen} onCreated={handleMeetingCreated} />`.

**Verify:** Playwright MCP — open modal, submit with title+date only (participants blank) → meeting appears in both lists without reload; submit with missing title/date → inline errors, no network call (check via `read_network_requests`); Cancel/close-icon/outside-click → closes without creating. Plus `ui-ux-pro-max` check.

---

## Phase 7: Frontend — meeting detail page multi-file list UI

**Files:**

- `apps/web/src/app/meetings/[id]/page.tsx`
- `apps/web/src/components/meetings/RecordingCard.tsx`
- `apps/web/src/components/meetings/MeetingRow.tsx`
- `apps/web/src/app/page.tsx` (its `handleRecordingUploaded`, alongside Phase 6's changes to this same file)

### `RecordingCard.tsx`

- Thread `recording.id` into `getRecordingContentUrl(meetingId, recording.id)` and `deleteMeetingRecording(meetingId, recording.id)`.
- **Drop the `onReplace` prop and "Replace" button** (confirmed decision). `RecordingCardProps` becomes `{ meetingId, recording, onDeleted }`; change `onDeleted` to `(recordingId: string) => void` so the parent removes just that one entry.
- Everything else (audio/video branch by `mimeType`, filename/size/date, `RecordingStatusChip`, transcript block, `FAILED` notice, delete-confirm `Modal`) unchanged structurally.

### `meetings/[id]/page.tsx`

- `MeetingDetail.recordings: Recording[]` replaces `.recording`.
- Render: map `meeting.recordings` to `<RecordingCard key={r.id} meetingId={meeting.id} recording={r} onDeleted={handleDeleted} />` inside the existing "Recording" `Card` (rename heading to "Recordings"), with an **always-present** `RecordingUploader` below the list (no more conditional swap between card/uploader) so users can always add another file. `RecordingUploader`'s own props/behavior need no change.
- `handleUploaded(recording)`: append — `setMeeting((current) => current ? { ...current, recordings: [...current.recordings, recording] } : current)`; keep bumping `pollGenerationRef.current`.
- `handleDeleted(recordingId)`: filter — `setMeeting((current) => current ? { ...current, recordings: current.recordings.filter((r) => r.id !== recordingId) } : current)`; keep bumping `pollGenerationRef.current`.
- Remove `isReplacing` state entirely (no longer applicable).
- Polling effect: replace `recordingStatus = meeting?.recording?.status ?? null` with `const hasPendingRecording = meeting?.recordings.some((r) => r.status === 'UPLOADED' || r.status === 'PROCESSING') ?? false`; guard becomes `if (!user || !hasPendingRecording) return;`. Rest of the interval/`pollGenerationRef` staleness-guard logic unchanged.

### `MeetingRow.tsx`

- `meeting.hasRecording` → `meeting.recordingCount`. Show a `Chip` with `{count} file{count === 1 ? '' : 's'}` when `recordingCount > 0`; otherwise keep the existing "Upload" `Button` opening `UploadRecordingModal` for the zero-file case only (no "add another" quick-upload from the list row — that's the detail page's job, keeps this row unchanged in spirit).
- `apps/web/src/app/page.tsx`'s `handleRecordingUploaded` (used by `MeetingRow`'s `onUploaded`) changes from setting `hasRecording: true` to `recordingCount: meeting.recordingCount + 1`.

**Verify:** Playwright MCP — upload two files to a meeting, confirm both show independent status/transcript progression; delete one, confirm the other and its transcript are untouched; confirm the home page's file-count chip updates correctly. Plus `ui-ux-pro-max` check (heading rename, layout with N cards + uploader).

---

## Phase 8: Tests

| File                                                                                  | Scope of change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/meetings/commands/handlers/upload-recording.handler.spec.ts`            | Rewrite: `createOrReplace` mock → `create`; `pruneMeetingDir` assertions change from `(meetingId, storagePath)` to `(meetingId, storagePaths: string[])` (mock `findByMeetingId` to return the current set); `updateStatusIfCurrent` assertions drop `meetingId`, match by `recordingId` only.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/api/src/meetings/recording-file-filter.spec.ts`                                 | Scan for any reference to the old route paths/`createOrReplace`; update if present, otherwise unaffected (MIME/extension filtering is orthogonal to cardinality).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/storage/storage.service.spec.ts`                                        | Update `pruneMeetingDir` cases for the new `keepStoragePaths: string[]` signature; add a genuine multi-file case (3 files, keep 2, confirm the 3rd is removed and the other 2 survive). `pruneAvatarDir` cases stay single-path — confirm the shared `pruneDir` refactor doesn't change avatar behavior.                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/api/src/transcription/transcript-text.spec.ts`, `transcription.service.spec.ts` | No change — transcription is already per-file/stateless.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/api/test/meetings-recording.e2e-spec.ts`                                        | Heavy rewrite. Route paths change (`/recording` → `/recordings`, content/delete gain `:recordingId`). Remove the "replace" scenario (a second upload now adds, not replaces). Add: uploading 2+ files and asserting both appear in `GET /meetings/:id`'s `recordings` array with independent ids/statuses; each file's content/delete routes scoped to its own `recordingId` (deleting one leaves the other's file+row intact); a `recordingId` belonging to a different meeting 404s; cascade delete of a meeting removes all its recordings; `recordingCount`/`recordings` field shapes on both read routes. Reuse the existing `UPLOADS_DIR` temp-dir-per-suite and stubbed `WHISPER_RUNNER` setup. |
| `apps/api/test/meetings.e2e-spec.ts`                                                  | Update response-shape assertions: `hasRecording`/`recording` → `recordingCount`/`recordings`. `POST /meetings` itself unaffected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Verify:** `pnpm --filter api test` and (`docker compose up -d postgres` running) `pnpm --filter api test:e2e` both green. No `apps/web` test suite exists — verification there is Playwright MCP + `ui-ux-pro-max`, already covered per-phase above.

---

## Phase 9: Documentation

| File                                                                                  | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/CLAUDE.md`                                                                  | Invariants section: rewrite the `updateStatusIfCurrent`-matches-by-`storagePath` paragraph to explain `recordingId`-matching (plain `create`, permanent id, no more upsert-in-place). `Layout` section's `src/meetings/` bullet: "meetings and their one recording" → "meetings and their recordings (many per meeting)". `Database` section: drop "(at most one per meeting...)" from the `MeetingRecording` bullet.                                                                                                                                                                 |
| `apps/web/CLAUDE.md`                                                                  | Check the `RecordingUploader`/`RecordingCard` sync-rule bullets for phrasing that implies singularity ("a recording"/"the recording") and pluralize where needed; the MIME/size-allowlist-sync rule itself is per-file already and needs no change.                                                                                                                                                                                                                                                                                                                                   |
| `docs/architecture/web.md`                                                            | `page.tsx` bullet: `hasRecording` → `recordingCount`; add the "+ Create meeting" button + `CreateMeetingModal` + prepend-on-create behavior. `meetings/[id]/page.tsx` bullet: rewrite for `recordings: Recording[]`, the list render + always-present uploader (no replace-toggle), the back button, the "any pending" polling condition. `RecordingCard` bullet: drop "Replace", document `onDeleted(recordingId)`. `MeetingRow` bullet: file-count Chip. New bullet for `CreateMeetingModal.tsx`. `api.ts` bullet: updated function list/signatures.                                |
| `docs/architecture/api.md`                                                            | `MeetingsController` route table: new paths + `:recordingId`. `get-meetings`/`get-meeting-by-id` bullets: `recordingCount`/`recordings`. Repository bullets: `RecordingsRepository.create`/`findByMeetingId`/`findById`/`delete(meetingId, recordingId)`/`updateStatusIfCurrent(recordingId, data)`; `MeetingsRepository` array-returning methods. "Recording upload/delete" sub-heading: `create` not upsert, multi-keep-path pruning, `recordingId`-based background-transcription matching. Prisma schema bullet: drop "at most one recording", describe the relaxed 1:N relation. |
| `docs/testing/web.md`                                                                 | `/` row: mention the create-meeting modal flow. `/meetings/{id}` row: mention the back button, multi-file list (independent status/transcript/delete), drop "the Replace flow".                                                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/testing/api.md`                                                                 | Rewrite the `meetings-recording.e2e-spec.ts` paragraph per Phase 8's new scope — drop replace-semantics language, describe multi-file scenarios.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `README.md`                                                                           | Frontend summary paragraph (~line 8): describe a file list with independent per-file status/transcript/delete and an always-present add-file control (drop "Replace"); add a line for the create-meeting modal and the back button. Recording storage / Transcription sections (~lines 38-44): pluralize "the recording"/"a recording" phrasing.                                                                                                                                                                                                                                      |
| `docs/meeting-recording-upload/prd.md`, `docs/meeting-recording-transcription/prd.md` | **Do not edit** — historical record of a superseded decision; this plan's Context section is the pointer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Verify:** `pnpm check:links` passes; re-read each updated doc to confirm nothing still describes one-recording-per-meeting, replace-in-place, or the old route paths as current.

---

## Execution order

Phases 1 and 2 are trivial and independent of everything else — any order, anytime. For the multi-file work: **3 → 5 → (6 and 7 in parallel, since they touch disjoint files once 5 lands) → 8 → 9**. The backend must exist before `api.ts` can be typed against it; `api.ts` must land before either frontend UI phase compiles; docs and tests are written last, against whatever shapes actually landed.

### Critical files

- `apps/api/prisma/schema.prisma`
- `apps/api/src/meetings/recordings.repository.ts`
- `apps/api/src/meetings/commands/handlers/upload-recording.handler.ts`
- `apps/api/src/storage/storage.service.ts`
- `apps/api/src/meetings/meetings.controller.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/app/meetings/[id]/page.tsx`
- `apps/web/src/app/page.tsx`
