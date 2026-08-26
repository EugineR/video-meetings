'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, Spinner } from '@heroui/react';
import { useAuthenticatedUser } from '@/lib/useAuthenticatedUser';
import {
  ApiError,
  getMeeting,
  type MeetingDetail,
  type Recording,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { AppHeader } from '@/components/layout/AppHeader';
import { ArrowLeftIcon, CalendarIcon, UsersIcon } from '@/components/icons';
import { RecordingCard } from '@/components/meetings/RecordingCard';
import { RecordingUploader } from '@/components/meetings/RecordingUploader';

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params.id;
  const router = useRouter();

  const { user, signOut } = useAuthenticatedUser();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by any direct local update (upload/delete) so a poll response already
  // in flight at that moment is recognized as stale and doesn't clobber it.
  const pollGenerationRef = useRef(0);

  useEffect(() => {
    if (!user) {
      return;
    }

    getMeeting(meetingId)
      .then(setMeeting)
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load the meeting. Please try again.',
        );
      });
  }, [meetingId, user]);

  const hasPendingRecording =
    meeting?.recordings.some(
      (r) => r.status === 'UPLOADED' || r.status === 'PROCESSING',
    ) ?? false;

  useEffect(() => {
    if (!user || !hasPendingRecording) {
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
  }, [meetingId, user, hasPendingRecording]);

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
    setMeeting((current) =>
      current
        ? {
            ...current,
            recordings: current.recordings.filter((r) => r.id !== recordingId),
          }
        : current,
    );
  }, []);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-linear-to-br from-accent/10 via-background to-background">
      <AppHeader email={user.email} onSignOut={signOut} />
      <div className="flex justify-center px-4 py-12">
        <div className="flex w-full max-w-2xl flex-col gap-6">
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
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              </Card.Content>
            </Card>
          ) : meeting === null ? (
            <div className="flex justify-center py-12">
              <Spinner aria-label="Loading meeting" />
            </div>
          ) : (
            <>
              <Card>
                <Card.Header>
                  <Card.Title>{meeting.title}</Card.Title>
                </Card.Header>
                <Card.Content className="flex flex-col gap-1.5">
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <CalendarIcon
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                    {formatDateTime(meeting.date)}
                  </p>
                  {meeting.participants.length > 0 ? (
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <UsersIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
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
                  {meeting.recordings.map((recording) => (
                    <RecordingCard
                      key={recording.id}
                      meetingId={meeting.id}
                      onDeleted={handleDeleted}
                      recording={recording}
                    />
                  ))}
                  <RecordingUploader
                    meetingId={meeting.id}
                    onUploaded={handleUploaded}
                  />
                </Card.Content>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
