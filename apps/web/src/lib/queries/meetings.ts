'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMeeting,
  getMeetings,
  type Meeting,
  type MeetingDetail,
  type MeetingListItem,
  type Recording,
} from '@/lib/api';
import { apiErrorMessage } from '@/lib/formErrors';
import { isMeetingSettled } from '@/lib/meetings';
import { useMeetingSummaryStatus } from '@/lib/useMeetingSummaryStatus';

/** Cache key of `GET /meetings`. See `useMeetingsQuery()`. */
export const meetingsQueryKey = ['meetings', 'list'] as const;

/**
 * Cache key of `GET /meetings/:id`. The list and the details sit in sibling branches
 * (`list` / `detail`) rather than the details nesting under the list key, so invalidating
 * one never drags the other along: a recording uploaded from the detail page has to
 * refetch that meeting, not every list entry.
 */
export function meetingQueryKey(meetingId: string) {
  return ['meetings', 'detail', meetingId] as const;
}

/**
 * How often the detail query refetches while the meeting is still catching up with the
 * API's background transcription and summarization.
 */
const MEETING_POLL_INTERVAL_MS = 4000;

export interface MeetingsQueryResult {
  /** The signed-in user's meetings, or `null` while loading or after a failure. */
  meetings: MeetingListItem[] | null;
  /** Set if `GET /meetings` failed. */
  meetingsError: string | null;
}

/**
 * The signed-in user's meetings. Left at the default freshness rather than the profile's
 * `staleTime: Infinity`: another session (or the API's background work) can add
 * recordings, so returning to `/` revalidates — from the cache first, so the list doesn't
 * blink back to its spinner.
 */
export function useMeetingsQuery(): MeetingsQueryResult {
  const { data, error } = useQuery({
    queryKey: meetingsQueryKey,
    queryFn: getMeetings,
  });

  return {
    meetings: data ?? null,
    meetingsError: error
      ? apiErrorMessage(error, 'Could not load meetings. Please try again.')
      : null,
  };
}

/**
 * Prepends a just-created meeting to the cached list, so it appears without a refetch.
 * `POST /meetings` returns the whole meeting and a new one has no recordings yet, so the
 * list entry can be built from the response instead of asking the API for it again.
 */
export function useAddCreatedMeeting(): (meeting: Meeting) => void {
  const queryClient = useQueryClient();

  return useCallback(
    (meeting: Meeting) => {
      const created: MeetingListItem = { ...meeting, recordingCount: 0 };
      queryClient.setQueryData<MeetingListItem[]>(
        meetingsQueryKey,
        (previous) => (previous ? [created, ...previous] : [created]),
      );
    },
    [queryClient],
  );
}

/**
 * Bumps one meeting's `recordingCount` in the cached list after an upload from a row.
 * The count is the only thing an upload changes about a list entry, and a meeting shown
 * in both "Recent meetings" and "All meetings" is one cached object, so both lists stay
 * in sync without a refetch.
 */
export function useCountUploadedRecording(): (meetingId: string) => void {
  const queryClient = useQueryClient();

  return useCallback(
    (meetingId: string) => {
      queryClient.setQueryData<MeetingListItem[]>(
        meetingsQueryKey,
        (previous) =>
          previous?.map((meeting) =>
            meeting.id === meetingId
              ? { ...meeting, recordingCount: meeting.recordingCount + 1 }
              : meeting,
          ),
      );
    },
    [queryClient],
  );
}

export interface MeetingDetailQueryResult {
  /** The meeting, or `null` while loading or after a failure. */
  meeting: MeetingDetail | null;
  /** Set if `GET /meetings/:id` failed — a 404 for an unknown meeting included. */
  meetingError: string | null;
  /** True while the shown summary may not cover the meeting's current recordings. */
  isSummaryPending: boolean;
  /** Whether the "Summary" card is worth rendering at all. */
  showSummarySection: boolean;
  /** Hand to `RecordingUploader`: shows the new recording, then refetches. */
  onRecordingUploaded: (recording: Recording) => void;
  /**
   * Hand to `RecordingCard`: drops the recording, distrusts the summary until a refetch
   * confirms it, then refetches.
   */
  onRecordingDeleted: (recordingId: string) => void;
}

/**
 * One meeting with its recordings and summary, kept current on its own.
 *
 * Polling lives in `refetchInterval` rather than in an interval a page has to set up and
 * tear down: the callback form is handed the cached meeting on every scheduling decision,
 * so the query stops refetching the moment the meeting settles (`isMeetingSettled`) and
 * starts again by itself when a new upload unsettles it. A failed refetch stops it too —
 * the page surfaces that error inline, and hammering an API that just answered with one
 * every four seconds would not help.
 *
 * Upload and deletion write the one thing they already know — the recording row that was
 * added or removed — into the cached meeting and *then* invalidate, so the tile list
 * reacts to the click immediately while the fields only the API can produce (transcript,
 * summary, `foldedRecordingIds`) still come from the refetch. Writing that row is what
 * makes the deletion path honest as well: `invalidateQueries` leaves `data` in place, so a
 * reset fingerprint alone would be re-advanced against the pre-deletion recordings during
 * the very next render and the summary would read as trusted again. Invalidating also
 * retires the old stale-response guard — it cancels an in-flight poll before starting the
 * refetch, so a response that was already on its way when the user uploaded or deleted can
 * no longer land on top of the newer state.
 */
export function useMeetingDetailQuery(
  meetingId: string,
): MeetingDetailQueryResult {
  const queryClient = useQueryClient();

  const { data, error } = useQuery({
    queryKey: meetingQueryKey(meetingId),
    queryFn: () => getMeeting(meetingId),
    refetchInterval: (query) => {
      const meeting = query.state.data;
      if (query.state.status === 'error' || !meeting) {
        return false;
      }
      return isMeetingSettled(meeting) ? false : MEETING_POLL_INTERVAL_MS;
    },
  });

  const meeting = data ?? null;
  const { isSummaryPending, showSummarySection, resetReconciliation } =
    useMeetingSummaryStatus(meeting);

  const refetchMeeting = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: meetingQueryKey(meetingId),
    });
  }, [meetingId, queryClient]);

  const patchCachedRecordings = useCallback(
    (update: (recordings: Recording[]) => Recording[]) => {
      queryClient.setQueryData<MeetingDetail>(
        meetingQueryKey(meetingId),
        (previous) =>
          previous
            ? { ...previous, recordings: update(previous.recordings) }
            : previous,
      );
    },
    [meetingId, queryClient],
  );

  const onRecordingUploaded = useCallback(
    (recording: Recording) => {
      patchCachedRecordings((recordings) => [...recordings, recording]);
      refetchMeeting();
    },
    [patchCachedRecordings, refetchMeeting],
  );

  const onRecordingDeleted = useCallback(
    (recordingId: string) => {
      resetReconciliation();
      patchCachedRecordings((recordings) =>
        recordings.filter((recording) => recording.id !== recordingId),
      );
      refetchMeeting();
    },
    [patchCachedRecordings, refetchMeeting, resetReconciliation],
  );

  return {
    meeting,
    meetingError: error
      ? apiErrorMessage(error, 'Could not load the meeting. Please try again.')
      : null,
    isSummaryPending,
    showSummarySection,
    onRecordingUploaded,
    onRecordingDeleted,
  };
}
