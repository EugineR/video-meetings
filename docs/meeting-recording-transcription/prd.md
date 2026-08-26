# PRD: Meeting recording transcription

**Date**: 2026-08-25
**Status**: Draft

## Goal

Automatically transcribe a meeting's uploaded recording (video or audio) using a local Whisper
model, so users get a text version of the recording without relying on an external service, and
can see how the transcription is progressing.

## Scenario

- User uploads an mp4 or mp3 recording to a meeting -> the upload succeeds and transcription
  starts automatically in the background.
- User opens the meeting page while transcription is running -> the page shows a "processing"
  status without a transcript yet.
- User opens the meeting page after transcription finishes -> the page shows a "done" status and
  the full transcript text.
- User opens the meeting page after transcription fails -> the page shows a "failed" status and no
  transcript text.
- User deletes the meeting's recording -> its transcript and transcription status are removed
  along with it.
- User uploads a new recording, replacing the previous one -> the previous transcript is discarded
  and transcription restarts for the new file.

## In scope

- Adding `audio/mpeg` (mp3) to the meeting recording upload's allowed MIME types, alongside the
  existing mp4/webm/quicktime video types, on both the API allowlist and the web uploader's mirror
  of it.
- Running a local Whisper transcription (`base` model) on a meeting's recording immediately after
  a successful upload, without user interaction.
- Persisting transcription status per meeting recording: pending, processing, done, or failed.
- Persisting the transcript text once transcription completes successfully.
- Exposing the transcription status and, once available, the transcript text through the API for
  the recording's meeting.
- Displaying the transcription status on the meeting page, and the transcript text once status is
  done.
- Re-running transcription from scratch when a recording is replaced.
- Deleting the stored transcript and status when the recording is deleted.

## Out of scope

- Transcription of any file not uploaded as a meeting's recording (e.g. standalone audio uploads
  unrelated to a meeting).
- Speaker diarization, timestamps, or word-level timing in the transcript.
- Manual retry, cancel, or re-run controls for a failed or in-progress transcription — retries, if
  any, are automatic.
- Editing the transcript text after generation.
- Searching, exporting, or downloading the transcript.
- Language selection or translation — transcription runs in the recording's spoken language as
  detected by Whisper.
- Using any Whisper model other than `base`, or making the model configurable.
- Any non-local (cloud/API-based) transcription provider.

## Technical constraints

- Transcription must run via a local Whisper installation (no external transcription API calls),
  using the `base` model size.
- Transcription must run asynchronously, outside the HTTP request that handles the upload — local
  Whisper inference on a full recording can take significantly longer than an acceptable HTTP
  response time.
- Transcription applies to whichever single recording a meeting currently has, consistent with the
  existing one-recording-per-meeting constraint.
- mp3 support is an extension of the existing recording upload path (`ALLOWED_RECORDING_MIME_TYPES`
  / `MAX_UPLOAD_SIZE_BYTES` and the web uploader's mirrored allowlist), not a separate upload
  endpoint.

## Acceptance criteria

- [ ] Uploading an mp3 recording succeeds, the same way an mp4 recording upload does today.
- [ ] After a recording upload completes, its transcription status becomes visible as pending or
      processing without further user action.
- [ ] Once transcription finishes successfully, the meeting page shows a "done" status and the
      transcript text.
- [ ] If transcription fails, the meeting page shows a "failed" status and no transcript text.
- [ ] Replacing a meeting's recording discards its prior transcript and status, and starts
      transcription again for the new recording.
- [ ] Deleting a meeting's recording also removes its transcript and transcription status.
- [ ] Transcription runs against the `base` Whisper model.
