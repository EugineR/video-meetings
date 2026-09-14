'use client';

import { useParams, useRouter } from 'next/navigation';
import { Card } from '@heroui/react';
import { formatDateTime } from '@/lib/format';
import { isMeetingSettled } from '@/lib/meetings';
import { useMeetingDetailQuery } from '@/lib/queries/meetings';
import { ArrowLeftIcon, CalendarIcon, SparklesIcon } from '@/components/icons';
import { usePageHeader } from '@/components/layout/PageHeaderProvider';
import { MeetingStatusBadge } from '@/components/meetings/MeetingStatusBadge';
import { MeetingSummarySection } from '@/components/meetings/MeetingSummarySection';
import { ParticipantAvatars } from '@/components/meetings/ParticipantAvatars';
import { RecordingCard } from '@/components/meetings/RecordingCard';
import { RecordingUploader } from '@/components/meetings/RecordingUploader';
import { Button } from '@/components/ui/Button';
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

  usePageHeader({
    breadcrumb: meeting ? `Meetings / ${meeting.title}` : 'Meetings',
    title: meeting ? meeting.title : 'Meeting',
  });

  return (
    <div className="flex flex-col gap-5 px-5 py-[22px] lg:gap-6 lg:px-[42px] lg:py-8">
      <div className="flex items-center justify-between">
        <Button
          className="w-fit gap-[7px] px-0 text-xs font-semibold text-muted hover:text-foreground"
          onPress={() => router.back()}
          variant="ghost"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          <span className="lg:hidden">Meetings</span>
          <span className="hidden lg:inline">Back to meetings</span>
        </Button>

        {meeting ? (
          <MeetingStatusBadge
            className="px-2.5 py-[5px] text-[10px]"
            isReady={isMeetingSettled(meeting)}
            pendingLabel={
              <>
                <span className="lg:hidden">Processing</span>
                <span className="hidden lg:inline">
                  Transcription in progress
                </span>
              </>
            }
            readyLabel="Ready"
            showDot
          />
        ) : null}
      </div>

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
          <div className="flex flex-col gap-3.5 rounded-[10px] border border-border bg-surface p-4 lg:hidden">
            <div className="flex flex-col gap-1.5">
              <h1 className="font-head text-[23px] font-semibold break-words text-foreground">
                {meeting.title}
              </h1>
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <CalendarIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                />
                {formatDateTime(meeting.date)}
              </p>
            </div>
            {meeting.participants.length > 0 ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <ParticipantAvatars
                  participants={meeting.participants}
                  size="compact"
                />
                <p className="min-w-0 flex-1 text-[11px] font-semibold break-words text-foreground">
                  {meeting.participants.join(', ')}
                </p>
              </div>
            ) : null}
          </div>

          <div className="hidden min-h-28 items-center justify-between gap-4 rounded-[10px] border border-border bg-surface px-[22px] py-4 lg:flex">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h1 className="font-head text-2xl font-semibold break-words text-foreground">
                {meeting.title}
              </h1>
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <CalendarIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0"
                />
                {formatDateTime(meeting.date)}
              </p>
            </div>
            {meeting.participants.length > 0 ? (
              <div className="flex min-w-0 items-center gap-3">
                <ParticipantAvatars participants={meeting.participants} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-mono text-[9px] font-semibold tracking-[0.8px] text-muted">
                    PARTICIPANTS
                  </p>
                  <p className="text-xs font-semibold break-words text-foreground">
                    {meeting.participants.join(', ')}
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-3 rounded-[10px] border border-border bg-surface p-3.5 lg:gap-4 lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-[3px] lg:gap-1">
                <h2 className="font-head text-[17px] font-semibold text-foreground lg:text-lg">
                  Recordings
                </h2>
                <p className="text-[10px] text-muted lg:text-[11px]">
                  <span className="lg:hidden">
                    Upload and review transcripts
                  </span>
                  <span className="hidden lg:inline">
                    Upload files, play recordings, and review transcripts.
                  </span>
                </p>
              </div>
              <p className="shrink-0 font-mono text-[9px] font-semibold tracking-[0.7px] text-accent-strong lg:text-[10px]">
                {meeting.recordings.length} FILES
              </p>
            </div>

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
          </div>

          {showSummarySection ? (
            <div className="flex flex-col gap-[15px] rounded-[10px] border border-border bg-surface p-3.5 lg:gap-[18px] lg:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-[2px] lg:gap-[3px]">
                  <h2 className="font-head text-[17px] font-semibold text-foreground lg:text-lg">
                    Meeting intelligence
                  </h2>
                  <p className="text-[10px] text-muted lg:text-[11px]">
                    AI-generated from this meeting&apos;s recordings
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-[5px] rounded-xl bg-accent-soft px-[7px] py-[5px] text-accent-strong lg:gap-1.5 lg:px-2.5">
                  <SparklesIcon aria-hidden="true" className="size-3" />
                  <span className="font-mono text-[8px] font-semibold tracking-[0.5px] lg:text-[9px]">
                    AI READY
                  </span>
                </div>
              </div>

              <MeetingSummarySection
                isUpdating={isSummaryPending}
                summary={meeting.summary}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
