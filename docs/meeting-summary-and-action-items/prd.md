# PRD: Meeting Summary and Action Items

**Date**: 2026-08-26
**Status**: Draft

## Goal

Once a meeting's recordings have been transcribed, automatically generate a meeting summary, a
list of action items (with an assignee when the transcript identifies one), and a list of
decisions made, using the Claude Agent SDK. Persist the result in the database and display it on
the meeting page once processing is complete.

## Scenario

- User uploads a meeting's recording(s) -> each recording transcribes in the background as today
  -> once a recording's transcript is `READY`, the summary generation job (re-)runs, folding that
  recording's transcript into the meeting's summary, action items and decisions built so far ->
  once every recording has reached a terminal transcription status (`READY` or `FAILED`), the
  meeting's summary is marked ready -> user opens the meeting page -> user sees the summary,
  action items (each with its assignee, if one was identified) and decisions, below the existing
  recording/transcript UI.
- User opens the meeting page while summary generation is still in progress -> user sees a
  processing indicator instead of the summary content, the same way an in-progress transcript is
  shown today.
- A meeting has only one recording -> the summary job runs once, after that recording's
  transcript is `READY`, over that single transcript.
- A meeting's only recording(s) all end in `FAILED` transcription -> there is no transcript text to
  summarize, so no summary is generated and none is shown.

## In scope

- Triggering summary generation as a background job whenever a recording's transcription reaches
  `READY`, without blocking the upload/transcription request-response cycle (same pattern as
  `UploadRecordingHandler` firing `TranscriptionService` today).
- Incremental summarization across multiple recordings belonging to the same meeting, ordered by
  `MeetingRecording.createdAt`: each run is given the meeting's transcripts processed so far plus
  the newly `READY` one, and must extend/update the existing summary, action items and decisions
  rather than reprocessing already-covered content from scratch or duplicating it.
- Excluding recordings whose transcription ended in `FAILED` from the summarization context.
- Using `ClaudeAgentService` (existing `ClaudeAgentModule`) to produce, per meeting: a prose
  summary, a list of action items (free-text description plus an assignee when the transcript
  names one, otherwise no assignee), and a list of decisions made.
- A status field on the meeting's summary tracking its lifecycle (e.g. no recordings/transcripts
  yet -> pending while any recording is still transcribing or a summarization run is in flight ->
  ready once the last recording has reached a terminal transcription status and the final
  summarization run has completed -> failed if a summarization run itself errors), following the
  same status-machine shape `MeetingRecording.status` already uses.
- Persisting the summary, action items and decisions in the database, scoped to the meeting (one
  summary per meeting, covering every one of its recordings).
- Displaying the summary, action items (with assignee when present) and decisions on the meeting
  detail page once the status is ready, and a processing/pending indicator otherwise — mirroring
  how the existing transcript status/text is shown today.
- Handling the case where every recording for a meeting fails transcription: no summary is
  generated, and the meeting page shows no summary section (or an explicit "not available" state)
  rather than a stuck processing indicator.

## Out of scope

- Letting the user manually edit, regenerate on demand, or delete a generated summary, action item
  or decision.
- Assigning action items to actual `User` records or meeting participants, or tracking their
  completion status — the assignee is stored as the free-text name/identifier the transcript
  mentions, nothing more.
- Notifying users (email, in-app) when a summary becomes ready.
- Exporting the summary/action items/decisions (PDF, calendar invite, task tracker integration).
- Re-summarizing a meeting after a recording is deleted or replaced post-hoc; the summary reflects
  whatever recordings existed and were transcribed at the time each summarization run occurred.
- Any language other than English for the generated summary/action items/decisions, consistent
  with transcription being fixed to English today.
- Streaming partial/live summary output to the client while a run is in progress.

## Technical constraints

- Must reuse `ClaudeAgentModule`/`ClaudeAgentService` (`apps/api/src/claude-agent/`) for the actual
  LLM call rather than introducing a second integration path; per its own doc comment, callers
  that only want a plain text/structured reply must pass `tools: []` explicitly.
- Must follow the CQRS conventions already established in `apps/api/CLAUDE.md` (commands for
  mutating the summary's state, queries for reading it, thin repository, handlers hold the logic).
- Background execution must not block the HTTP request that causes a recording's transcription to
  finish (the same non-awaited fire-and-forget pattern `UploadRecordingHandler` already uses for
  `TranscriptionService`).
- Writes from the background summarization run must be safe against a meeting or recording having
  been deleted mid-run (mirroring `RecordingsRepository.updateStatusIfCurrent`'s
  matched-on-current-row-id approach for transcription).
- Requires a new Prisma model (and migration) to persist the summary, its status, action items and
  decisions against a meeting; `BigInt` fields are not implicated here, but any new response DTO
  must follow the existing own-resource/404-not-403 and JSON-serialization rules already documented
  as invariants in `apps/api/CLAUDE.md`.
- Ordering multiple recordings' transcripts into the incremental summarization context must use
  `MeetingRecording.createdAt`, matching how recordings are otherwise ordered elsewhere in the app.
- The LLM call must be structured (e.g. requesting a defined JSON shape for summary/action
  items/decisions) so the response can be parsed and persisted deterministically, rather than
  parsed out of free-form prose.

## Acceptance criteria

- [ ] After a meeting's single recording finishes transcribing (`READY`), a summary, action items
      list, and decisions list are generated and persisted for that meeting without any manual
      trigger.
- [ ] For a meeting with multiple recordings, each recording reaching `READY` triggers a
      re-generation that incorporates that recording's transcript into the existing summary,
      action items and decisions, without duplicating content already extracted from earlier
      recordings.
- [ ] A recording whose transcription ends in `FAILED` is excluded from the summarization context,
      and does not block summarization of the meeting's other, successfully transcribed
      recordings.
- [ ] Each action item is stored with its free-text description and, when the source transcript
      names a responsible person, that person's name as the assignee; when no one is named, the
      action item has no assignee.
- [ ] Decisions are stored as a distinct list from action items and from the summary text.
- [ ] The meeting detail page shows a processing/pending state while the meeting's summary is not
      yet ready, and shows the summary, action items (with assignee where present) and decisions
      once it is.
- [ ] A meeting where every recording fails transcription never shows a summary section stuck in a
      processing state — it settles into a final "not available"/absent state.
- [ ] Deleting a meeting or one of its recordings while a summarization run is in flight does not
      throw an unhandled error or resurrect a deleted row.
