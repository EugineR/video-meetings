'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Spinner } from '@heroui/react';
import { clearAccessToken, getStoredUser, type StoredUser } from '@/lib/auth';
import {
  ApiError,
  getMeeting,
  type MeetingDetail,
  type Recording,
} from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { CalendarIcon, UsersIcon } from '@/components/icons';
import { RecordingCard } from '@/components/meetings/RecordingCard';
import { RecordingUploader } from '@/components/meetings/RecordingUploader';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default function MeetingDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const meetingId = params.id;

  const [user, setUser] = useState<StoredUser | null>(null);
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) {
      router.replace('/login');
      return;
    }
    // localStorage is only available client-side, so this must run in an effect rather than during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(storedUser);

    getMeeting(meetingId)
      .then(setMeeting)
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not load the meeting. Please try again.',
        );
      });
  }, [meetingId, router]);

  const handleSignOut = () => {
    clearAccessToken();
    router.replace('/login');
  };

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
      <AppHeader email={user.email} onSignOut={handleSignOut} />
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
                    {dateFormatter.format(new Date(meeting.date))}
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
