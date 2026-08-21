'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, Spinner } from '@heroui/react';
import { useAuthenticatedUser } from '@/lib/useAuthenticatedUser';
import { ApiError, getMeetings, type MeetingListItem } from '@/lib/api';
import { AppHeader } from '@/components/layout/AppHeader';
import { MeetingRow } from '@/components/meetings/MeetingRow';

export default function Home() {
  const { user, profile, signOut } = useAuthenticatedUser();
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    getMeetings()
      .then(setMeetings)
      .catch((err: unknown) => {
        setMeetingsError(
          err instanceof ApiError
            ? err.message
            : 'Could not load meetings. Please try again.',
        );
      });
  }, [user]);

  const handleRecordingUploaded = useCallback((meetingId: string) => {
    setMeetings((current) =>
      current
        ? current.map((meeting) =>
            meeting.id === meetingId
              ? { ...meeting, hasRecording: true }
              : meeting,
          )
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

  const recentMeetings = meetings
    ? [...meetings]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3)
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-linear-to-br from-accent/10 via-background to-background">
      <AppHeader
        avatarUpdatedAt={profile?.avatarUpdatedAt}
        email={user.email}
        hasAvatar={profile?.hasAvatar}
        name={profile?.name}
        onSignOut={signOut}
      />
      <div className="flex justify-center px-4 py-12">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          {recentMeetings.length > 0 ? (
            <Card>
              <Card.Header>
                <Card.Title>Recent meetings</Card.Title>
                <Card.Description>
                  Your 3 most recent meetings.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <ul className="flex flex-col gap-2">
                  {recentMeetings.map((meeting) => (
                    <MeetingRow
                      highlighted
                      key={meeting.id}
                      meeting={meeting}
                      onUploaded={handleRecordingUploaded}
                    />
                  ))}
                </ul>
              </Card.Content>
            </Card>
          ) : null}

          <Card>
            <Card.Header>
              <Card.Title>All meetings</Card.Title>
              {meetings && meetings.length > 0 ? (
                <Card.Description>Total: {meetings.length}</Card.Description>
              ) : null}
            </Card.Header>
            <Card.Content>
              {meetingsError ? (
                <p className="text-sm text-danger" role="alert">
                  {meetingsError}
                </p>
              ) : meetings === null ? (
                <div className="flex justify-center py-4">
                  <Spinner aria-label="Loading meetings" size="sm" />
                </div>
              ) : meetings.length === 0 ? (
                <p className="text-sm text-muted">
                  You haven&apos;t created any meetings yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {meetings.map((meeting) => (
                    <MeetingRow
                      key={meeting.id}
                      meeting={meeting}
                      onUploaded={handleRecordingUploaded}
                    />
                  ))}
                </ul>
              )}
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}
