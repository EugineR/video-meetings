# PRD: Meetings UX Improvements — Clickable Header, Manual Meeting Creation, Back Navigation, Multi-File Recordings

**Date**: 2026-08-26
**Status**: Draft

## Goal

Close four usability gaps surfaced from design review: the header logo/title is a dead end instead of a link home, there is no way to create a meeting by hand, the meeting detail page has no way back, and a meeting can only ever hold one recording file. Together these bring the app's navigation and recording flow in line with the reviewed mockups.

## Scenario

- User clicks the logo or "Video Meetings" title anywhere in the app -> navigates to the home page (`/`).
- User is on the home page and clicks "+ Create meeting" -> a modal opens with fields for title, date & time, and participants.
- User fills in the required fields and submits -> the meeting is created, the modal closes, and the new meeting appears in the meeting lists on the home page.
- User cancels the modal or clicks outside it -> the modal closes and no meeting is created.
- User is on a meeting detail page (`/meetings/{id}`) and clicks the back button -> returns to the previous page in browser history (equivalent to `history.back()`).
- User is on a meeting detail page and uploads a recording file -> the file is added to the meeting's file list without removing any previously uploaded files.
- User uploads a second (and further) recording file to the same meeting -> each file is transcribed independently and each shows its own status (pending/processing/ready/failed) and transcript.
- User deletes one file from a meeting with multiple files -> only that file and its transcript are removed; the other files are unaffected.

## In scope

- Making the logo + "Video Meetings" title in `AppHeader` a link to `/`.
- A "Create meeting" button on the home page that opens a modal with fields: title (required), date & time (required), participants (optional, comma-separated emails), matching the validation already enforced by the existing `POST /meetings` endpoint (`CreateMeetingDto`: `title`, `date`, `participants[]`).
- Modal behavior: client-side validation feedback, submit/cancel actions, closing on successful creation, and refreshing the home page's meeting lists to include the new meeting.
- A back button on the meeting detail page (`/meetings/{id}`) that navigates to the previous history entry (`router.back()` / `history.back()` equivalent), placed top-left per the reviewed mockup.
- Extending meeting recordings from one-per-meeting to many-per-meeting:
  - Data model change so a meeting can hold multiple recording files instead of at most one.
  - Upload UI that accepts adding further files to a meeting that already has recordings (no more forced "replace" of the single existing file).
  - Each file lists its own name, size, upload date, and transcription status, and shows/hides its own transcript independently, matching the reviewed file-list design.
  - Each file can be deleted independently of the others.
  - Each uploaded file is transcribed independently in the background, following the same `UPLOADED` -> `PROCESSING` -> `READY`/`FAILED` lifecycle already used for the single-recording flow.
  - Meeting detail page polling extended to cover the status of all of a meeting's files, not just one.

## Out of scope

- Any change to the file types or size limits currently accepted for recordings.
- Bulk actions across files (e.g. deleting or downloading all files at once).
- Editing an existing meeting (title/date/participants) — this PRD covers only creating new meetings by hand.
- Any redesign of the meeting list, meeting card, or profile pages beyond the header link.
- Reordering or renaming uploaded files.
- Changing the underlying transcription engine or its accuracy/behavior.

## Technical constraints

- The current schema has `MeetingRecording` capped at one row per meeting (`apps/api/CLAUDE.md`: "at most one per meeting"); supporting multiple files requires a Prisma migration to a genuine one-to-many relation and updates to every recording-related endpoint (upload, list, stream, delete) and to the transcription trigger so it operates per-file.
- `POST /meetings` already exists and already validates `title`, `date` (ISO date string), and `participants` (array of emails) — the new modal must match this contract rather than inventing a new one.
- Existing recording constraints stay in force per file: `ALLOWED_RECORDING_MIME_TYPES`, `MAX_UPLOAD_SIZE_BYTES` on the API, mirrored client-side by `ALLOWED_MIME_TYPES`/`MAX_SIZE_BYTES` in `RecordingUploader.tsx` (`apps/web/CLAUDE.md`).
- Recording streaming URLs authenticate via `?token=` query param (not a header), since `<video>`/`<audio>` elements can't set headers — this must extend unchanged to each file's stream URL.
- The meeting detail page's existing poll-while-`UPLOADED`/`PROCESSING` behavior must generalize to polling while any of the meeting's files are in a non-terminal status.
- The back button must use client-side history navigation, not a hardcoded link to a fixed route, so it behaves correctly regardless of how the user arrived at the meeting page.

## Acceptance criteria

- [ ] Clicking the logo or app title in the header from any authenticated page navigates to `/`.
- [ ] A "Create meeting" button is visible on the home page and opens a modal on click.
- [ ] Submitting the modal with a title and date creates a meeting via `POST /meetings` and the new meeting appears in the home page's meeting lists without a manual page reload.
- [ ] Submitting the modal with a missing title or date shows inline validation and does not call the API.
- [ ] Canceling the modal (Cancel button, close icon, or outside click) closes it without creating a meeting.
- [ ] A back button is visible top-left on `/meetings/{id}` and navigates to the previous page in history when clicked.
- [ ] A meeting detail page can hold more than one recording file at once, each independently uploaded.
- [ ] Each file on the meeting detail page shows its own name, size, status, and (once ready) its own transcript, independent of the other files.
- [ ] Deleting one file removes only that file and its transcript; other files on the meeting remain untouched.
- [ ] Uploading a new file to a meeting that already has one or more files does not overwrite or remove the existing ones.
- [ ] The meeting detail page continues polling until every file's status has settled to `READY` or `FAILED`.
