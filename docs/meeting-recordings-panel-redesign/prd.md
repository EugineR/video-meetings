# PRD: Meeting Recordings Panel Redesign

**Date**: 2026-08-28
**Status**: Draft

## Goal

Redesign the "Recordings" section on the meeting detail page (`/meetings/{id}`) to match the provided mockup: a compact, always-on-top upload zone, a condensed row-style tile per recording, playback moved into a modal, and the transcript shown as an inline expand/collapse panel on the tile itself.

## Scenario

- User opens a meeting's detail page -> sees the upload drop zone pinned at the top of the Recordings card, above the list of already-uploaded recordings.
- User drags a file onto the drop zone (or clicks it to pick a file) -> upload starts, progress shows inside the same compact zone, and on success a new recording tile appears below it.
- User hovers the filename on a recording tile -> the filename turns blue and the cursor becomes a pointer.
- User clicks the filename -> a modal opens containing the recording's video/audio player.
- User closes the player modal -> returns to the recordings list, tile state unchanged.
- User clicks "Show transcript" on a `READY` recording's tile -> the tile expands in place to reveal the transcript text; clicking again collapses it.
- User clicks the red delete icon on a recording tile -> the existing delete confirmation flow runs as today, and the tile is removed from the list on success.

## In scope

- Reposition `RecordingUploader` (drag-and-drop zone) above the recordings list, always visible, with a fixed maximum height of 200–300px regardless of content or window size.
- Rework `RecordingCard` into a compact row/tile layout (per recording) showing, left to right: a small play indicator/icon, the filename, file size, and the "added on" date; the transcription status on its own line/row within the tile; a delete action as a red icon-only button anchored to the right edge of the tile.
- Make the filename clickable: on hover it turns the accent/blue color and the cursor becomes `pointer`; on click it opens a modal containing the existing `<video>`/`<audio>` player for that recording (reusing the current MIME-type-based element choice and `getRecordingContentUrl`).
- Add an expand/collapse control on each tile, styled in the same blue accent as the mockup's disclosure ("Показать транскрипцию" / "Show transcript"), that toggles an inline transcript block rendered inside the tile (not in the modal). Only shown when `status === 'READY'` and `transcriptText` is present, matching current behavior for when a transcript is available.
- Preserve existing behavior for the `FAILED` status message and for the delete confirmation modal.
- Keep the multi-recording layout: each recording gets its own tile, stacked, exactly as today's `meeting.recordings.map(...)`.
- Update `docs/architecture/web.md` and `docs/testing/web.md` to reflect the new component structure and the new flows to verify (drop zone position, player modal, inline transcript toggle).

## Out of scope

- Any change to the recordings data model, upload API, transcription pipeline, or polling logic in `apps/api`.
- Multi-file selection or multi-file drag-and-drop in one action (dropping/picking remains one file at a time, as today).
- Reordering, renaming, or any other new recording action beyond play (via modal) and delete.
- Changes to the Meeting info card or the Summary section layout.
- A dedicated download button/action — not requested; the mockup's download icon is not part of this iteration.

## Technical constraints

- Must reuse `getRecordingContentUrl`, `deleteMeetingRecording`, and the existing `RecordingStatus` type from `src/lib/api.ts` — no new API surface is introduced.
- Must keep the `<audio>` vs `<video>` element choice keyed off `recording.mimeType === 'audio/mpeg'`, per the existing rule in `apps/web/CLAUDE.md`.
- Must use HeroUI v3 components (`Modal`, `Button`, `Chip`, etc.) and `onPress` (not `onClick`), consistent with the rest of the app.
- Controls must stay at the 44px (mobile) / 40px (desktop) touch-target minimum and maintain WCAG AA contrast, per `apps/web/CLAUDE.md`.
- The upload drop zone's capped height (200–300px) must still accommodate its existing states: idle prompt, drag-over highlight, and in-progress `ProgressBar` with cancel button, without clipping content.
- Any new component/interaction must be visually verified with the `ui-ux-pro-max` skill and functionally verified with the Playwright MCP server, per `apps/web/CLAUDE.md`'s UI testing rule.

## Acceptance criteria

- [ ] The upload drop zone renders above the recordings list at all times (empty list or populated list) and its rendered height never exceeds 300px.
- [ ] Each recording renders as a single compact tile showing filename, file size, added date, and status, with no separate always-visible player element on the page.
- [ ] Hovering a recording's filename changes its color to the accent/blue color and the cursor to `pointer`.
- [ ] Clicking a recording's filename opens a modal that plays that recording (video element for video MIME types, audio element for `audio/mpeg`), and closing the modal leaves the underlying tile list intact.
- [ ] For a `READY` recording with a transcript, an expand/collapse control in the same blue accent as the mockup toggles an inline transcript block within that recording's own tile; the transcript is never shown inside the player modal.
- [ ] A `FAILED` recording still shows the existing failure message on its tile; recordings without a ready transcript show no expand/collapse control.
- [ ] Deleting a recording is triggered by a red icon-only button on the right edge of the tile and goes through the existing confirmation modal before removal.
- [ ] `docs/architecture/web.md` and `docs/testing/web.md` reflect the redesigned components and flows.
