'use client';

import { useParams, useRouter } from 'next/navigation';
import { Button, Card } from '@heroui/react';
import { formatDateTime } from '@/lib/format';
import { useMeetingDetailQuery } from '@/lib/queries/meetings';
import { ArrowLeftIcon, CalendarIcon, UsersIcon } from '@/components/icons';
import { MeetingSummarySection } from '@/components/meetings/MeetingSummarySection';
import { RecordingCard } from '@/components/meetings/RecordingCard';
import { RecordingUploader } from '@/components/meetings/RecordingUploader';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const {
    meeting,
    meetingError,
    isSummaryPending,
    showSummarySection,
    onRecordingUploaded,
    onRecordingDeleted,
  } = useMeetingDetailQuery(params.id);

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
      {meetingError ? (
        <Card>
          <Card.Content>
            <ErrorText>{meetingError}</ErrorText>
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
                onUploaded={onRecordingUploaded}
              />
              {meeting.recordings.map((recording) => (
                <RecordingCard
                  key={recording.id}
                  meetingId={meeting.id}
                  onDeleted={onRecordingDeleted}
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
