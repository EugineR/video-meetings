# Plan: Meeting Recordings Panel Redesign

**PRD:** @docs/meeting-recordings-panel-redesign/prd.md
**Date:** 2026-08-28

## Implementation Phases

### Phase 1: Upload zone repositioning

**Goal:** The drag-and-drop upload zone always sits above the recordings list, capped to a 200–300px height in every state.
**Affects:** frontend
**Tasks:**

- [x] Move `RecordingUploader` above the `meeting.recordings.map(...)` list in `src/app/meetings/[id]/page.tsx`, so it renders first inside the Recordings card regardless of whether any recordings exist.
- [x] Cap `RecordingUploader`'s rendered height to 200–300px and verify its idle, drag-over, and uploading (progress bar + cancel button) states all fit without clipping or internal scrolling.
- [x] Confirm existing drag-and-drop, click-to-pick, upload progress, and cancel behavior are unaffected by the layout/position change.
- [x] Add a Playwright test asserting the uploader renders above any recording tiles on page load, and that its bounding-box height stays within the cap in both idle and uploading states.

**Done when:** The uploader is pinned above the recordings list on every load (empty or populated list), its height never exceeds 300px in any state, and upload/drag/cancel flows behave exactly as before.

### Phase 2: Compact recording tile with player modal

**Goal:** `RecordingCard` becomes a compact row tile with a clickable filename that opens playback in a modal, and delete becomes a red icon-only button.
**Affects:** frontend
**Tasks:**

- [x] Extract the existing `<video>`/`<audio>` playback markup (mimeType-keyed) into a new player modal component, opened/closed via HeroUI `Modal`.
- [x] Rework `RecordingCard` into a compact tile showing filename, file size, added date, and the status chip, dropping the always-visible player element.
- [x] Make the filename interactive: accent/blue color and `pointer` cursor on hover, `onPress` opens the player modal for that recording.
- [x] Replace the full-width "Delete" button with a red icon-only button anchored to the tile's right edge, preserving the existing delete-confirmation modal and `onDeleted` wiring.
- [x] Add Playwright tests covering: hover style change on the filename, filename click opens the modal with the correct player element (video vs. audio) for a recording's `mimeType`, and the delete icon opens the confirmation modal and removes the tile on success.

**Done when:** Every recording renders as a compact tile with no inline player; clicking the filename plays that recording in a modal; deleting still goes through the existing confirmation flow via the new icon button.

### Phase 3: Inline transcript panel and documentation

**Goal:** Each tile gets its own expand/collapse transcript panel (rendered inline, not in the modal), `FAILED` messaging is preserved, and docs are updated to match the new structure.
**Affects:** frontend
**Tasks:**

- [x] Add a blue-accent expand/collapse control to each tile, shown only when `status === 'READY'` and `transcriptText` is present.
- [x] Render the transcript text inside the tile when expanded, collapse hides it again; confirm the player modal never shows transcript content.
- [x] Keep the existing `FAILED` status message rendering on a tile's own row when no transcript is available.
- [x] Update `docs/architecture/web.md` and `docs/testing/web.md` to describe the new component structure (uploader position, compact tile, player modal, inline transcript toggle) and the flows to verify.
- [x] Add Playwright tests covering: expand/collapse toggles transcript visibility on a `READY` tile, no expand control appears for non-`READY` or transcript-less recordings, and the `FAILED` message still renders on its tile.

**Done when:** All PRD acceptance criteria hold end-to-end (uploader position/height, compact tiles, hover/click-to-play modal, inline transcript toggle, `FAILED` messaging, icon-only delete), and both docs reflect the redesigned Recordings section.
