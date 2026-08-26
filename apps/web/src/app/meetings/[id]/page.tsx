'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Spinner } from '@heroui/react';
import { useAuthenticatedUser } from '@/lib/useAuthenticatedUser';
import {
  ApiError,
  getMeeting,
  type MeetingDetail,
  type Recording,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { AppHeader } from '@/components/layout/AppHeader';
import { CalendarIcon, UsersIcon } from '@/components/icons';
import { RecordingCard } from '@/components/meetings/RecordingCard';
import { RecordingUploader } from '@/components/meetings/RecordingUploader';

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const meetingId = params.id;

  const { user, signOut } = useAuthenticatedUser();
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);

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

  const recordingStatus = meeting?.recording?.status ?? null;

  useEffect(() => {
    if (
      !user ||
      (recordingStatus !== 'UPLOADED' && recordingStatus !== 'PROCESSING')
    ) {
      return;
    }

    const intervalId = setInterval(() => {
      getMeeting(meetingId)
        .then(setMeeting)
        .catch(() => {
          // Transient polling error — keep the last known state and retry on the next tick.
        });
    }, 4000);

    return () => clearInterval(intervalId);
  }, [meetingId, user, recordingStatus]);

  const handleUploaded = useCallback((recording: Recording) => {
    setIsReplacing(false);
    setMeeting((current) => (current ? { ...current, recording } : current));
  }, []);

  const handleDeleted = useCallback(() => {
    setMeeting((current) =>
      current ? { ...current, recording: null } : current,
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
                  <Card.Title>Recording</Card.Title>
                </Card.Header>
                <Card.Content>
                  {meeting.recording && !isReplacing ? (
                    <RecordingCard
                      meetingId={meeting.id}
                      onDeleted={handleDeleted}
                      onReplace={() => setIsReplacing(true)}
                      recording={meeting.recording}
                    />
                  ) : (
                    <RecordingUploader
                      meetingId={meeting.id}
                      onUploaded={handleUploaded}
                    />
                  )}
                </Card.Content>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
