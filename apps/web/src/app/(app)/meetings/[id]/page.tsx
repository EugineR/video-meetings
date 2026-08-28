'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card } from '@heroui/react';
import {
  ApiError,
  getMeeting,
  type MeetingDetail,
  type Recording,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ArrowLeftIcon, CalendarIcon, UsersIcon } from '@/components/icons';
import { MeetingSummarySection } from '@/components/meetings/MeetingSummarySection';
import { RecordingCard } from '@/components/meetings/RecordingCard';
import { RecordingUploader } from '@/components/meetings/RecordingUploader';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

/** Order-independent equality check for two recording-id lists. */
function sameRecordingIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedB = [...b].sort();
  return [...a].sort().every((id, index) => id === sortedB[index]);
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params.id;
  const router = useRouter();

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by any direct local update (upload/delete) so a poll response already
  // in flight at that moment is recognized as stale and doesn't clobber it.
  const pollGenerationRef = useRef(0);

  useEffect(() => {
    getMeeting(meetingId)
      .then(setMeeting)
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load the meeting. Please try again.',
        );
      });
  }, [meetingId]);

  const hasPendingRecording =
    meeting?.recordings.some(
      (r) => r.status === 'UPLOADED' || r.status === 'PROCESSING',
    ) ?? false;

  // A summary section is worth showing once either a summary row exists (any status) or a
  // recording is still on its way there (not yet `FAILED`) — otherwise there is nothing to show
  // (no recordings yet, or every recording ended in `FAILED` transcription).
  const showSummarySection =
    meeting !== null &&
    (meeting.summary !== null ||
      meeting.recordings.some((r) => r.status !== 'FAILED'));

  // The fingerprint (id + status) of the set of recordings the summary last caught up with.
  // Updated conditionally during render — React's documented pattern for deriving state from a
  // changed prop/state without the extra render+commit round-trip a `useEffect` would add (see
  // "Adjusting state when a prop changes" in the React docs) — rather than in an effect.
  const [reconciledRecordingsSignature, setReconciledRecordingsSignature] =
    useState<string | null>(null);
  const recordingsSignature = meeting
    ? meeting.recordings
        .map((r) => `${r.id}:${r.status}`)
        .sort()
        .join(',')
    : null;
  if (meeting && recordingsSignature !== reconciledRecordingsSignature) {
    const everyRecordingTerminal = meeting.recordings.every(
      (r) => r.status === 'READY' || r.status === 'FAILED',
    );
    const readyRecordingIds = meeting.recordings
      .filter((r) => r.status === 'READY')
      .map((r) => r.id);
    // The summary has caught up with the *current* set of recordings once it's reached a
    // terminal state itself — `FAILED`, or `READY` with `foldedRecordingIds` covering every
    // currently-`READY` recording, or absent because none of them ever succeeded — while every
    // recording is also terminal. Recording the fingerprint at that point (rather than trusting
    // `summary.status` alone) is what lets a *later* recording transition (e.g. a second recording
    // finishing after the first already produced a `READY` summary) be detected as "pending again",
    // even though `summary.status` would still read as a final value from the earlier, now-outdated
    // run. Requiring `foldedRecordingIds` to match — rather than `status === 'READY'` alone — also
    // rules out the API's `update_meeting` agent tool briefly settling `status` to `READY` mid-fold
    // (it never touches `foldedRecordingIds`), which would otherwise read as caught up before the
    // fold's real, final write lands.
    const summaryCaughtUp =
      meeting.summary?.status === 'FAILED' ||
      (meeting.summary?.status === 'READY' &&
        sameRecordingIds(
          meeting.summary.foldedRecordingIds,
          readyRecordingIds,
        )) ||
      (meeting.summary === null && readyRecordingIds.length === 0);
    if (everyRecordingTerminal && summaryCaughtUp) {
      setReconciledRecordingsSignature(recordingsSignature);
    }
  }

  const isSummaryPending =
    meeting !== null && recordingsSignature !== reconciledRecordingsSignature;

  useEffect(() => {
    if (!hasPendingRecording && !isSummaryPending) {
      return;
    }

    const generation = pollGenerationRef.current;
    const intervalId = setInterval(() => {
      getMeeting(meetingId)
        .then((updated) => {
          if (pollGenerationRef.current === generation) {
            setMeeting(updated);
          }
        })
        .catch((err: unknown) => {
          if (pollGenerationRef.current !== generation) {
            return;
          }
          clearInterval(intervalId);
          setError(
            err instanceof ApiError
              ? err.message
              : 'Could not refresh the meeting. Please try again.',
          );
        });
    }, 4000);

    return () => clearInterval(intervalId);
  }, [meetingId, hasPendingRecording, isSummaryPending]);

  const handleUploaded = useCallback((recording: Recording) => {
    pollGenerationRef.current += 1;
    setMeeting((current) =>
      current
        ? { ...current, recordings: [...current.recordings, recording] }
        : current,
    );
  }, []);

  const handleDeleted = useCallback((recordingId: string) => {
    pollGenerationRef.current += 1;
    // A deleted recording can leave the meeting's (still-locally-cached) summary stale relative
    // to the new recording set — e.g. it was READY based partly on the recording just removed —
    // without that necessarily being visible from the leftover recordings' own statuses alone
    // (deleting the meeting's only recording leaves an empty, vacuously "all terminal" list).
    // Clearing the fingerprint here, rather than leaving whatever it last matched, forces
    // `isSummaryPending` true until a poll response confirms the summary has actually caught up
    // with the post-deletion recordings, instead of the page trusting a summary it can no longer
    // vouch for.
    setReconciledRecordingsSignature(null);
    setMeeting((current) =>
      current
        ? {
            ...current,
            recordings: current.recordings.filter((r) => r.id !== recordingId),
          }
        : current,
    );
  }, []);

  return (
    <>
      <Button
        className="h-11 self-start md:h-10"
        variant="secondary"
        onPress={() => router.back()}
      >
        <ArrowLeftIcon className="size-4" />
        Back
      </Button>
      {error ? (
        <Card>
          <Card.Content>
            <ErrorText>{error}</ErrorText>
          </Card.Content>
        </Card>
      ) : meeting === null ? (
        <LoadingState subject="meeting" />
      ) : (
        <>
          <Card>
            <Card.Header>
              <Card.Title>{meeting.title}</Card.Title>
            </Card.Header>
            <Card.Content className="flex flex-col gap-1.5">
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <CalendarIcon aria-hidden="true" className="size-4 shrink-0" />
                {formatDateTime(meeting.date)}
              </p>
              {meeting.participants.length > 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <UsersIcon aria-hidden="true" className="size-4 shrink-0" />
                  {meeting.participants.join(', ')}
                </p>
              ) : null}
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Recordings</Card.Title>
            </Card.Header>
            <Card.Content className="flex flex-col gap-6">
              <RecordingUploader
                meetingId={meeting.id}
                onUploaded={handleUploaded}
              />
              {meeting.recordings.map((recording) => (
                <RecordingCard
                  key={recording.id}
                  meetingId={meeting.id}
                  onDeleted={handleDeleted}
                  recording={recording}
                />
              ))}
            </Card.Content>
          </Card>

          {showSummarySection ? (
            <Card>
              <Card.Header>
                <Card.Title>Summary</Card.Title>
              </Card.Header>
              <Card.Content>
                <MeetingSummarySection
                  isUpdating={isSummaryPending}
                  summary={meeting.summary}
                />
              </Card.Content>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
