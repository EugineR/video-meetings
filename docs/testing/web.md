# apps/web — testing reference

`apps/web` has **no automated test suite**: `pnpm test` at the repo root reaches `apps/api`
only, and `package.json` in this workspace configures no test script. A UI change is
verified by hand instead, and the rule that says so is in `apps/web/CLAUDE.md` because it
is binding on every UI change.

> Related: [architecture](../architecture/web.md) · [apps/api testing](./api.md)

## The two required checks

Any UI change (new component, styling change, layout change, etc.) in this app is not considered complete until it has been visually verified using both of the following, in the same turn as the change:

- The `ui-ux-pro-max` skill — to check the change against design/UX guidelines (styles, color, typography, layout, accessibility, etc.).
- The Playwright MCP server (`mcp__playwright__*` tools) — not the `claude-in-chrome` extension — to actually load the page in a browser, interact with it, and check console/network output as needed.

Do not report a UI task as done without having run both checks.

## What to exercise

The app is small enough to walk end to end. The flows below are the ones a UI change can
break; which of them apply depends on what changed (see [architecture](../architecture/web.md)
for what each page renders):

| Route            | Flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/register`      | validation messages, password show/hide, duplicate email (409) inline error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/login`         | wrong credentials (401) inline error, redirect to `/` on success                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/`              | spinner until the auth check resolves, redirect to `/login` with no session, "Recent"/"All meetings" lists, upload from a row's modal, the "+ Create meeting" modal (validation, success prepending the new meeting to both lists, cancel/close without creating)                                                                                                                                                                                                                                                                                                               |
| `/profile`       | the header's avatar and name arriving from any authenticated route without a refetch (the profile is one cached query), identity + "Joined" date, "Edit profile"                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/profile/edit`  | display name save (Save re-disables itself on success), password change (wrong current password as a field-level 400, the session surviving the reissued token), avatar stage → Save → remove, each section saving independently and the header updating without a reload                                                                                                                                                                                                                                                                                                       |
| `/meetings/{id}` | detail render, the back button (`router.back()`, including a direct-URL visit with no prior history), the always-present `RecordingUploader` pinned above the recordings list (renders first whether the list is empty or populated, height capped to 200–300px in its idle/drag-over/uploading states), the multi-file recordings list (each entry its own compact tile — status chip, delete, inline transcript toggle — independent of its siblings), filename hover/click opening `RecordingPlayerModal`, delete confirmation, 404 for an unknown or another user's meeting |

Two things are easy to miss because they are not visible in a happy path: an upload's
progress bar and its Cancel button (`AbortController`, rejecting with
`UploadCancelledError`), and the client-side MIME/size rejection, which must match what
`apps/api` enforces — see the sync rule in `apps/web/CLAUDE.md`.

Recording tile flows worth walking explicitly on any change to `RecordingCard.tsx`,
`RecordingPlayerModal.tsx`, or the uploader's position:

- **Uploader position/height** — on both an empty and a populated recordings list, the
  uploader renders above every tile and its bounding-box height never exceeds 300px,
  including mid-upload (progress bar + Cancel button) and drag-over states.
- **Filename → player modal** — hovering a tile's filename turns it accent/blue with a
  pointer cursor; clicking it opens `RecordingPlayerModal` with a `<video>` element for a
  video MIME type or an `<audio>` element for `audio/mpeg`; closing the modal (via its
  close button) leaves the tile list unchanged. The modal never renders transcript text.
- **Transcribing loader → toggle, no shift** — an `UPLOADED`/`PROCESSING` recording shows
  a spinner + "Transcribing…" in the same slot (same min-height) the "Show transcript"
  toggle occupies once `READY`; watch the tile's bounding box across that status
  transition and confirm nothing else in the tile moves.
- **Inline transcript toggle, animated** — a `READY` recording with `transcriptText` shows
  a blue "Show transcript" control; clicking it grows an inline panel inside that tile
  open (not an instant show) with the transcript text and flips the control to "Hide
  transcript" (`aria-expanded` reflects state); clicking again shrinks it closed the same
  way. Confirm the collapsed panel's wrapper has `aria-hidden="true"` and the expanded
  one `"false"`. A recording that is not `READY`, or is `READY` with no transcript yet,
  shows no toggle at all.
- **`FAILED` messaging** — a `FAILED` recording shows the existing failure notice on its
  own row instead of a transcript toggle.
- **Delete** — the red icon-only button on a tile's right edge opens the shared
  `ConfirmModal` before removing the tile on success. Walk both answers (confirm and
  cancel) and all three ways out of the dialog — the backdrop, Escape and the close
  control — and confirm focus returns to the button that opened it. A failed delete keeps
  the dialog open with the message **inside** it, not behind it in the tile.

Any change to `ConfirmModal` is exercised on both of its call sites, since they are the whole
population: a recording delete here and the avatar removal on `/profile/edit`.

Summary catch-up flow worth walking on any change to `MeetingSummarySection.tsx` or
`useMeetingSummaryStatus`/`isMeetingSettled`: a `MeetingSummary` whose `status` is already
`READY` but whose `foldedRecordingIds` doesn't yet cover every currently-`READY` recording
(the API's `update_meeting` agent tool can leave the row in exactly this state mid-fold —
see `docs/architecture/api.md`) must render the existing summary/action items/decisions
content **with** an inline "Updating — more recordings are still being processed…" banner
above it, and the page must keep polling until a later fetch's `foldedRecordingIds` catches
up, at which point the banner disappears without a manual reload. Reproduce it by hand by
setting a recording `READY` and inserting/leaving a `MeetingSummary` row whose
`foldedRecordingIds` omits that recording's id.

`apps/api` must be running (`pnpm dev:api`) and reachable at `NEXT_PUBLIC_API_URL`, or
every page renders its inline error state instead of the change under test.
