# Plan: Meeting Detail Page — Meetwise Design Migration

**PRD:** [prd.md](./prd.md)
**Date:** 2026-09-14

## Implementation Phases

### Phase 1: Move the page onto the Meetwise shell

**Goal:** `/meetings/[id]` renders inside `DashboardShell` (sidebar + top bar) instead of
`AppShell`, with its current content untouched — the tracer bullet that proves the shell swap
works before any visual redesign of the content itself.
**Affects:** frontend
**Tasks:**

- [ ] Relocate the route from `apps/web/src/app/(app)/(workspace)/meetings/[id]` to
      `apps/web/src/app/(app)/(dashboard)/meetings/[id]`. `/profile` and `/profile/edit` stay on
      `(workspace)`/`AppShell`.
- [ ] Parametrize `AppTopBar` (`apps/web/src/components/layout/AppTopBar.tsx`) with
      `title`/`breadcrumb`/`searchPlaceholder` props, defaulting to today's dashboard copy so `/`
      renders unchanged; have the detail page pass the meeting's title/breadcrumb once loaded and
      a neutral fallback while loading or on error.
- [ ] Confirm `MobileTopBar`/`MobileBottomNav`/`MobileNavDrawer` need no per-page override for
      this route (the design's mobile top bar on the meeting detail screen carries no
      page-specific text — same as today).
- [ ] Update the route-group doc comments in `(dashboard)/layout.tsx` and `(workspace)/layout.tsx`,
      `apps/web/CLAUDE.md`'s Layout section, and `docs/architecture/web.md` to reflect the new
      boundary.

**Done when:** `/meetings/[id]` renders inside the sidebar/top-bar shell with every existing
behavior intact (data fetch, upload, delete, summary polling); `/` and `/profile` are unaffected.
Verified with Playwright MCP (navigate to a meeting, confirm sidebar/top bar render and the
existing upload/delete/summary flows still work) and a regression check of `/` and `/profile`.

### Phase 2: Meeting header and back navigation

**Goal:** The back-navigation row and meeting overview card match the design.
**Affects:** frontend
**Tasks:**

- [ ] Restyle the back-navigation row and add the meeting-level ready/processing status badge
      next to it (design nodes `IVjgU`/`P5nbir`/`sAUDQ`), driven by the existing
      `isMeetingSettled(meeting)` (`apps/web/src/lib/meetings.ts`) — no new state.
- [ ] Restyle the meeting overview card: title, `CalendarIcon` + `formatDateTime(meeting.date)`
      row, participants row (design node `NJjki`).
- [ ] Build a small initials-avatar row for participants (design shows overlapping avatar
      circles, e.g. component `Avatar / Initial` `o15d3T` / `Avatar Group / Overflow` `JLHn6`) —
      purely presentational, reusing the existing avatar tint tokens (`bg-avatar-*`) and
      `getInitials()` (`apps/web/src/lib/format.ts`); participants stay a plain string list, no
      new data.
- [ ] Responsive pass matching the mobile stack (design node `MSwyt`).

**Done when:** header/overview card matches the design on desktop and mobile for a meeting with
and without participants, and for the loading/error states already rendered by the page.
Verified with Playwright MCP across those states.

### Phase 3: Recordings panel

**Goal:** Upload zone and recording tiles match the design, same upload/delete/transcript
behavior as today.
**Affects:** frontend
**Tasks:**

- [ ] Restyle `RecordingUploader` (`apps/web/src/components/meetings/RecordingUploader.tsx`)
      idle/uploading states to match `Recording Upload Zone` (`Mn57N`) — keep `useFileSelection`
      wiring untouched.
- [ ] Restyle `RecordingCard` (`apps/web/src/components/meetings/RecordingCard.tsx`) to match
      `Recording Tile` (`pcOhu`): play row (opens the player modal) with filename/metadata, delete
      icon button (unchanged `useConfirmAction`/`ConfirmModal` wiring), status row
      ("Transcript ready" / "Transcribing…" / failed), and the "Show/Hide transcript" disclosure
      with its inline transcript panel. Preserve the `audio`/`video` mimeType branch and
      `RecordingStatusChip` status mapping.
- [ ] Add the section heading with the live file count ("`{n} FILES`" from
      `meeting.recordings.length`, design node `mO8U4`).
- [ ] Responsive pass matching the mobile stack (design node `WuOMR`).

**Done when:** uploading, deleting, and expanding/collapsing a transcript all work exactly as
before, now in the new visuals, for both an audio (`audio/mpeg`) and a video recording. Verified
with Playwright MCP: upload a recording and watch its status progress via polling
(`UPLOADED`→`PROCESSING`→`READY`), expand/collapse its transcript, delete it through the confirm
modal.

### Phase 4: Recording player modal chrome

**Goal:** The player modal's surrounding chrome matches the design; playback itself keeps using
native browser controls (per the fidelity decision in the PRD).
**Affects:** frontend
**Tasks:**

- [ ] Restyle `RecordingPlayerModal`'s (`apps/web/src/components/meetings/RecordingPlayerModal.tsx`)
      header (filename + size/date, close icon) and footer note ("Transcript remains expanded in
      the recording tile") to match `Recording Player Dialog / Desktop` (`d3H49D`). The
      `<audio controls>`/`<video controls>` element stays as-is — no custom waveform or progress
      track.
- [ ] Responsive pass matching `Recording Player Dialog / Mobile` (`BvZbc`) /
      `Meetwise — Recording player modal · Mobile` (`N2FZu`).
- [ ] Confirm the `isOpen`/`onOpenChange` contract and the trigger in `RecordingCard` are
      unchanged.

**Done when:** the modal opens/closes exactly as before (from the recording tile, via close
button, backdrop, and Escape) with the new chrome, for both an audio and a video recording, on
desktop and mobile. Verified with Playwright MCP.

### Phase 5: Meeting intelligence panel and final verification

**Goal:** The summary/action-items/decisions section matches the design, and the whole page is
verified end-to-end across states and breakpoints.
**Affects:** frontend
**Tasks:**

- [ ] Restyle `MeetingSummarySection` (`apps/web/src/components/meetings/MeetingSummarySection.tsx`)
      and its host card to match the `Meeting intelligence panel` (`g2z9tC`): AI-ready badge,
      summary text, action items with assignee chips, decisions list. Preserve the
      pending/`isUpdating`/failed states unchanged.
- [ ] Responsive pass matching the mobile stack (design node `LGUb2`).
- [ ] Confirm the sidebar's existing stub nav items ("Tasks"/"People") and
      `SidebarStorageUsage` render as-is via the shared `AppSidebar` — no new stub work needed
      here, since they're already markup-only from the prior dashboard redesign.
- [ ] Full page pass with the `ui-ux-pro-max` skill and Playwright MCP, across every state
      (loading, 404 error, empty recordings, populated recordings, summary pending/ready/failed)
      on both desktop and mobile viewports, per `apps/web/CLAUDE.md`'s "Testing UI changes" rule.
- [ ] Update `docs/testing/web.md` with any new flows/states worth covering there.

**Done when:** `/meetings/[id]` matches the Pencil design end-to-end on desktop and mobile, every
state above renders correctly, and both required verification passes (`ui-ux-pro-max`, Playwright)
have been run and pass.
