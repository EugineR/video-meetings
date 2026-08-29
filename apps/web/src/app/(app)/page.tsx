'use client';

import { useMemo, useState } from 'react';
import { Card } from '@heroui/react';
import { recentMeetings } from '@/lib/meetings';
import {
  useAddCreatedMeeting,
  useCountUploadedRecording,
  useMeetingsQuery,
} from '@/lib/queries/meetings';
import { CreateMeetingModal } from '@/components/meetings/CreateMeetingModal';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

export default function Home() {
  const { meetings, meetingsError } = useMeetingsQuery();
  const addCreatedMeeting = useAddCreatedMeeting();
  const countUploadedRecording = useCountUploadedRecording();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const recent = useMemo(
    () => (meetings ? recentMeetings(meetings) : []),
    [meetings],
  );

  return (
    <>
      <Button className="self-start" onPress={() => setIsCreateOpen(true)}>
        <PlusIcon className="size-4" />
        Create meeting
      </Button>

      {recent.length > 0 ? (
        <Card>
          <Card.Header>
            <Card.Title render={(props) => <h2 {...props} />}>
              Recent meetings
            </Card.Title>
            <Card.Description>Your 3 most recent meetings.</Card.Description>
          </Card.Header>
          <Card.Content>
            <ul className="flex flex-col gap-2">
              {recent.map((meeting) => (
                <MeetingRow
                  highlighted
                  key={meeting.id}
                  meeting={meeting}
                  onUploaded={() => countUploadedRecording(meeting.id)}
                />
              ))}
            </ul>
          </Card.Content>
        </Card>
      ) : null}

      <Card>
        <Card.Header>
          <Card.Title render={(props) => <h2 {...props} />}>
            All meetings
          </Card.Title>
          {meetings && meetings.length > 0 ? (
            <Card.Description>Total: {meetings.length}</Card.Description>
          ) : null}
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          {/* A failed *refetch* leaves the cached list in place, so the error is a line
              above the list rather than a replacement for it — the rows on screen are
              still real data, and blanking them out would lose more than it explains. */}
          {meetingsError ? <ErrorText>{meetingsError}</ErrorText> : null}
          {meetings === null ? (
            meetingsError ? null : (
              <LoadingState subject="meetings" />
            )
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
                  onUploaded={() => countUploadedRecording(meeting.id)}
                />
              ))}
            </ul>
          )}
        </Card.Content>
      </Card>

      <CreateMeetingModal
        isOpen={isCreateOpen}
        onCreated={addCreatedMeeting}
        onOpenChange={setIsCreateOpen}
      />
    </>
  );
}
