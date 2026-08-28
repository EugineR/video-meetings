'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Spinner } from '@heroui/react';
import {
  ApiError,
  getMeetings,
  type Meeting,
  type MeetingListItem,
} from '@/lib/api';
import { CreateMeetingModal } from '@/components/meetings/CreateMeetingModal';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { PlusIcon } from '@/components/icons';

export default function Home() {
  const [meetings, setMeetings] = useState<MeetingListItem[] | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    getMeetings()
      .then(setMeetings)
      .catch((err: unknown) => {
        setMeetingsError(
          err instanceof ApiError
            ? err.message
            : 'Could not load meetings. Please try again.',
        );
      });
  }, []);

  const handleMeetingCreated = useCallback((meeting: Meeting) => {
    setMeetings((current) => {
      const newMeeting: MeetingListItem = { ...meeting, recordingCount: 0 };
      return current ? [newMeeting, ...current] : [newMeeting];
    });
  }, []);

  const handleRecordingUploaded = useCallback((meetingId: string) => {
    setMeetings((current) =>
      current
        ? current.map((meeting) =>
            meeting.id === meetingId
              ? { ...meeting, recordingCount: meeting.recordingCount + 1 }
              : meeting,
          )
        : current,
    );
  }, []);

  const recentMeetings = meetings
    ? [...meetings]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3)
    : [];

  return (
    <>
      <Button
        className="h-11 self-start md:h-10"
        onPress={() => setIsCreateOpen(true)}
      >
        <PlusIcon className="size-4" />
        Create meeting
      </Button>

      {recentMeetings.length > 0 ? (
        <Card>
          <Card.Header>
            <Card.Title>Recent meetings</Card.Title>
            <Card.Description>Your 3 most recent meetings.</Card.Description>
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

      <CreateMeetingModal
        isOpen={isCreateOpen}
        onCreated={handleMeetingCreated}
        onOpenChange={setIsCreateOpen}
      />
    </>
  );
}
