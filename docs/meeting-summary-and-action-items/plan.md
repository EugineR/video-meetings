# Plan: Meeting Summary and Action Items

**PRD:** @docs/meeting-summary-and-action-items/prd.md
**Date:** 2026-08-26

## Implementation Phases

### Phase 1: Backend — data model & single-recording summary generation

**Goal:** For a meeting with one recording, once its transcription reaches `READY`, a summary,
action items and decisions are generated via `ClaudeAgentService`, persisted, and readable through
the meeting detail API.
**Affects:** backend, database
**Tasks:**

- [ ] Add a `MeetingSummary` Prisma model (one-to-one with `Meeting`; a status enum mirroring
      `RecordingStatus`'s shape, `summaryText`, `actionItems` and `decisions` as structured JSON)
      plus the migration.
- [ ] Create a `MeetingSummaryModule`/`MeetingSummaryService` that calls `ClaudeAgentService`
      (`tools: []`) with a prompt requesting a defined JSON shape — summary text, an action-items
      list (description + optional assignee), and a decisions list — from a transcript.
- [ ] Add a `MeetingSummaryRepository` (create/update-by-meetingId, status transitions) following
      the existing thin-repository/CQRS convention, and wire the trigger into
      `UploadRecordingHandler.transcribeInBackground`: once a recording's transcription persists as
      `READY`, fire summary generation in the background (non-awaited, matched-on-current-id writes
      like `updateStatusIfCurrent`).
- [ ] Include the summary's status, summary text, action items and decisions in
      `MeetingDetailResponse`/`GetMeetingByIdHandler`.
- [ ] Tests: `MeetingSummaryService` unit tests against a stubbed `ClaudeAgentRunner`,
      `MeetingSummaryRepository` unit tests, and an e2e test uploading a single recording (stubbed
      transcription + summarization) that asserts `GET /meetings/:id` eventually returns the
      generated summary/action items/decisions.

**Done when:** Uploading a single recording to a meeting causes a `MeetingSummary` row to reach
`READY` in the background, and `GET /meetings/:id` returns its summary text, action items and
decisions.

### Phase 2: Backend — incremental multi-recording summarization

**Goal:** Meetings with multiple recordings get one coherent summary: each newly-`READY` recording
re-runs summarization incorporating the prior result without duplicating content, `FAILED`
recordings are excluded, and the summary settles to a final status once every recording is
terminal.
**Affects:** backend
**Tasks:**

- [ ] Extend the `MeetingSummaryService` prompt to accept the meeting's previously generated
      summary/action items/decisions plus the newest transcript, instructing the model to extend
      and de-duplicate rather than restart from scratch.
- [ ] Change the trigger so each newly-`READY` recording re-runs summarization over all of the
      meeting's `READY` recordings ordered by `createdAt`, excluding any `FAILED` ones; drive the
      summary's status (pending while any recording is non-terminal, ready once every recording is
      terminal and the last run succeeded, failed if a run errors).
- [ ] Guard summarization writes against the meeting or a recording having been deleted mid-run,
      matching on the summary's/meeting's current row rather than a pre-run snapshot.
- [ ] Handle the all-recordings-`FAILED` case: no summary is produced or left in a processing
      state.
- [ ] Tests: covering ordering/deduplication across 2-3 recordings, `FAILED`-recording exclusion,
      the all-`FAILED` case, and mid-run deletion safety.

**Done when:** A meeting with several recordings produces one non-duplicated summary, action-items
and decisions set once all recordings are transcribed, correctly skipping failed ones, with no
incorrect writes when a meeting or recording is deleted mid-run.

### Phase 3: Frontend — display summary, action items and decisions

**Goal:** The meeting page shows the generated summary, action items (with assignee when present)
and decisions once ready, and a processing indicator otherwise.
**Affects:** frontend
**Tasks:**

- [ ] Extend `src/lib/api.ts`'s `MeetingDetail` type (and parsing) to include the summary's status,
      summary text, action items and decisions from the API.
- [ ] Add a meeting-summary section component rendering the summary text, the action items list
      (description plus assignee when present), and the decisions list.
- [ ] Wire it into `/meetings/[id]/page.tsx`: a processing/pending state while the summary status
      isn't `READY`, no section when there is nothing to show, the full section once `READY`.
- [ ] Extend the page's existing polling condition to also keep polling while the summary status is
      non-terminal, so the page catches up without a manual reload.
- [ ] Verify visually with the `ui-ux-pro-max` skill and the Playwright MCP server, per
      `apps/web/CLAUDE.md`'s UI-testing rule.

**Done when:** Opening a meeting page shows a processing indicator while the summary isn't ready,
and the summary/action items (with assignees)/decisions once it is — verified in the browser.
