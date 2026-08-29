import type { MeetingDetail, MeetingListItem } from '@/lib/api';

/**
 * The `count` most recently dated meetings, most recent first — the home page's
 * "Recent meetings" card. Sorts a copy: `Array.prototype.sort` mutates in place, and
 * the cached list `useMeetingsQuery` returns is also what "All meetings" renders in
 * API order right below, so resorting it in place would resort that section too.
 */
export function recentMeetings(
  meetings: MeetingListItem[],
  count = 3,
): MeetingListItem[] {
  return [...meetings]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, count);
}

/**
 * Splits the free-text participants field into the string array the API takes.
 * Blank entries are dropped, so a trailing comma or a stray space produces `[]`
 * rather than an empty participant — `CreateMeetingDto.participants` has no
 * `@IsOptional()`, so the array is always sent, never omitted.
 */
export function parseParticipants(value: string): string[] {
  return value
    .split(',')
    .map((participant) => participant.trim())
    .filter((participant) => participant.length > 0);
}

/** Order-independent equality check for two recording-id lists. */
function sameRecordingIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedB = [...b].sort();
  return [...a].sort().every((id, index) => id === sortedB[index]);
}

/**
 * The fingerprint (every recording's `id:status`, order-independent) of the set of
 * recordings a summary can be measured against. Two meetings with the same fingerprint
 * have nothing left for the summary to catch up with that it hasn't already seen.
 */
export function recordingsSignature(meeting: MeetingDetail): string {
  return meeting.recordings
    .map((recording) => `${recording.id}:${recording.status}`)
    .sort()
    .join(',');
}

/** True while any recording is still on its way to a transcript. */
function hasPendingRecording(meeting: MeetingDetail): boolean {
  return meeting.recordings.some(
    (recording) =>
      recording.status === 'UPLOADED' || recording.status === 'PROCESSING',
  );
}

/**
 * Whether the summary has caught up with the meeting's *current* set of recordings:
 * it reached a terminal state itself — `FAILED`, or `READY` with `foldedRecordingIds`
 * covering exactly the currently-`READY` recordings, or absent because none of them ever
 * succeeded.
 *
 * Requiring `foldedRecordingIds` to match — rather than trusting `status === 'READY'`
 * alone — is what lets a *later* recording transition (a second recording finishing after
 * the first already produced a `READY` summary) read as "not caught up", even though
 * `status` would still read as a final value from the earlier, now-outdated run. It also
 * rules out the API's `update_meeting` agent tool briefly settling `status` to `READY`
 * mid-fold (it never touches `foldedRecordingIds`), which would otherwise read as caught
 * up before the fold's real, final write lands.
 */
function isSummaryCaughtUp(meeting: MeetingDetail): boolean {
  const readyRecordingIds = meeting.recordings
    .filter((recording) => recording.status === 'READY')
    .map((recording) => recording.id);

  return (
    meeting.summary?.status === 'FAILED' ||
    (meeting.summary?.status === 'READY' &&
      sameRecordingIds(
        meeting.summary.foldedRecordingIds,
        readyRecordingIds,
      )) ||
    (meeting.summary === null && readyRecordingIds.length === 0)
  );
}

/**
 * Whether the meeting has stopped moving on its own: no recording is still being
 * transcribed *and* the summary has caught up with the recordings that are left.
 *
 * This is the "any recording pending or summary not caught up" condition the detail page
 * polls on, stated the other way round: `apps/api` transcribes and summarizes in the
 * background after an upload, so an unsettled meeting is exactly the one the page has to
 * keep refetching until it settles.
 */
export function isMeetingSettled(meeting: MeetingDetail): boolean {
  return !hasPendingRecording(meeting) && isSummaryCaughtUp(meeting);
}

/**
 * Whether a summary section is worth showing at all: either a summary row exists (any
 * status) or a recording is still on its way there (not yet `FAILED`). Otherwise there is
 * nothing to show — no recordings yet, or every recording ended in `FAILED` transcription.
 */
export function hasSummarySection(meeting: MeetingDetail): boolean {
  return (
    meeting.summary !== null ||
    meeting.recordings.some((recording) => recording.status !== 'FAILED')
  );
}
