# PRD: Meeting Detail Page — Meetwise Design Migration

## Problem

`/meetings/[id]` still renders on the original `AppShell` chrome (gradient background, centered
`max-w-2xl` column, no sidebar), while `/` was already migrated to the Meetwise dashboard design
(`DashboardShell`, sidebar, top bar) in a prior effort. The two pages now look like different
apps. The Pencil design source (`design/meetwise.pen`) already includes a matching mockup for the
meeting detail page — desktop, mobile, and its recording-player modal — that needs to be brought
into code.

## Goal

Migrate `/meetings/[id]` to the Meetwise design system shown in `design/meetwise.pen`, with no
change to existing functionality: the same data (`useMeetingDetailQuery`), the same upload/delete/
transcription/summary behavior, the same routes and props contracts — only markup and styling
change.

## Design source

`design/meetwise.pen`, frame **"Meetwise — Meeting detail"**. Relevant node IDs:

- Desktop: `PhRp8` (main area: top bar + content), `M799bt` (sidebar instance).
- Mobile: `W3I472` (mobile top bar instance), `eCii8` (mobile content instance).
- Recording player modal, desktop: `m2chb`/`CDBkV` (page behind the modal), `esfr7` (modal overlay).
- Recording player modal, mobile: `N2FZu`.
- Design system (colors, type, component library): `DtVzY`.

The underlying reusable components are `Meeting Detail Content / Desktop` (`lj15y`) and
`Meeting Detail Content / Mobile` (`eB8f1`) — structurally identical (back nav + status badge,
meeting overview card, recordings panel, meeting intelligence panel), mobile is a single-column
stack of the same sections.

## Scope

Visual/layout only, for the desktop and mobile breakpoints:

1. Move the page onto the Meetwise sidebar/top-bar shell (`DashboardShell`) instead of `AppShell`.
2. Restyle the back-navigation row and add a meeting-level ready/processing status badge, driven
   by the existing `isMeetingSettled()` logic.
3. Restyle the meeting overview card (title, date, participants).
4. Restyle the recordings panel (upload zone, recording tiles, transcript disclosure) — same
   upload/delete/status/transcript-expand behavior as today.
5. Restyle the recording player modal's chrome (header, close, footer note).
6. Restyle the meeting intelligence panel (summary, action items, decisions) — same
   pending/ready/failed states as today.

## Explicit decision: recording player fidelity

The design's player modal shows a custom UI (large play button, waveform visualization, custom
progress track and controls). Building that would mean replacing the native `<audio controls>` /
`<video controls>` element currently used by `RecordingPlayerModal` with a fully custom player —
a functional change, not just a visual one, and out of scope here.

**Decision: keep the native `<audio>`/`<video>` playback controls.** Only the modal's surrounding
chrome (header with filename/metadata, close button, footer note) is restyled to match the design.

## Explicitly out of scope / no new stub UI needed

The user's brief called out adding markup-only stubs for anything the design shows that has no
logic yet (e.g. table filters, a sidebar storage widget), gated later behind a feature flag. The
meeting detail page's design does not introduce anything new in that category:

- The sidebar's "Tasks"/"People" nav items and the `SidebarStorageUsage` widget are inherited
  as-is from `AppSidebar`/`DashboardShell` — already markup-only stubs from the prior dashboard
  redesign, unchanged here.
- The recordings panel in the design has no filter control or anything else without a code
  counterpart.

So this migration needs no new stub markup of its own — every visual element in the meeting
detail mockup maps to functionality that already exists in `apps/web`.

## Acceptance criteria

- `/meetings/[id]` renders inside `DashboardShell` (sidebar + top bar on desktop, top bar +
  bottom nav + drawer on mobile), matching the design's layout and tokens.
- All existing behavior is unchanged and verified: recording upload (with progress/cancel),
  recording delete (via `ConfirmModal`), transcript status polling and expand/collapse, the
  recording player modal (audio and video), and the summary/action-items/decisions section in all
  its states (pending, ready, failed).
- `/` and `/profile`/`/profile/edit` are unaffected.
- Verified visually with the `ui-ux-pro-max` skill and interactively with Playwright MCP, per
  `apps/web/CLAUDE.md`'s "Testing UI changes" rule.
