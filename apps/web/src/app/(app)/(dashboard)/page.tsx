'use client';

import { useMemo, useState } from 'react';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { getGreeting } from '@/lib/format';
import { recentMeetings } from '@/lib/meetings';
import {
  useAddCreatedMeeting,
  useCountUploadedRecording,
  useMeetingsQuery,
} from '@/lib/queries/meetings';
import { useProfileQuery } from '@/lib/queries/profile';
import { CreateMeetingModal } from '@/components/meetings/CreateMeetingModal';
import { MeetingListRow } from '@/components/meetings/MeetingListRow';
import { MeetingTableRow } from '@/components/meetings/MeetingTableRow';
import { RecentMeetingCard } from '@/components/meetings/RecentMeetingCard';
import { ListFilterIcon, PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

const TABLE_COLUMNS = [
  { label: 'MEETING', width: undefined },
  { label: 'DATE', width: 145 },
  { label: 'PARTICIPANTS', width: 170 },
  { label: 'FILES', width: 90 },
  { label: 'STATUS', width: 130 },
  { label: '', width: 28 },
] as const;

export default function Home() {
  const { user } = useAuthenticatedUserContext();
  const { profile } = useProfileQuery();
  const { meetings, meetingsError } = useMeetingsQuery();
  const addCreatedMeeting = useAddCreatedMeeting();
  const countUploadedRecording = useCountUploadedRecording();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const recent = useMemo(
    () => (meetings ? recentMeetings(meetings) : []),
    [meetings],
  );

  const displayName = profile?.name?.trim() || user.email;

  return (
    <div className="flex flex-col gap-6 px-5 py-[22px] lg:gap-[26px] lg:px-[42px] lg:py-8">
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1.5 lg:gap-[7px]">
          <h1 className="font-head text-2xl font-semibold text-foreground lg:text-[30px]">
            {getGreeting()}, {displayName}
          </h1>
          <p className="text-[13px] text-muted lg:text-sm">
            Capture conversations, turn decisions into action.
          </p>
        </div>

        <Button
          className="w-full lg:w-auto"
          onPress={() => setIsCreateOpen(true)}
        >
          <PlusIcon className="size-4" />
          Create meeting
        </Button>
      </div>

      {recent.length > 0 ? (
        <section className="flex flex-col gap-2.5 lg:gap-[13px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-head text-base font-semibold text-foreground lg:text-lg">
                Recent meetings
              </h2>
              <span className="rounded-[10px] bg-tile px-2 py-0.5 font-mono text-[10px] text-muted lg:text-[11px]">
                {recent.length}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-accent-strong lg:text-xs">
              View all →
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-3.5">
            {recent.map((meeting) => (
              <RecentMeetingCard
                key={meeting.id}
                meeting={meeting}
                onUploaded={() => countUploadedRecording(meeting.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5 lg:gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-head text-base font-semibold text-foreground lg:text-lg">
              All meetings
            </h2>
            {meetings && meetings.length > 0 ? (
              <span className="text-[10px] text-muted lg:text-[11px]">
                {meetings.length} total
              </span>
            ) : null}
          </div>

          {/* No filtering exists yet — inert markup, per the design's mockup. */}
          <div
            aria-disabled="true"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[11px] font-medium text-foreground lg:h-[34px]"
          >
            <ListFilterIcon
              aria-hidden="true"
              className="size-3.5 text-muted"
            />
            <span className="hidden lg:inline">Filter</span>
          </div>
        </div>

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
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
            <div className="hidden lg:block">
              <div className="flex h-[34px] items-center border-b border-border bg-subtle px-4">
                {TABLE_COLUMNS.map((column) => (
                  <span
                    key={column.label}
                    className="text-[9px] font-semibold tracking-[0.7px] text-muted-strong"
                    style={
                      column.width
                        ? { width: column.width, flexShrink: 0 }
                        : { flex: 1 }
                    }
                  >
                    {column.label}
                  </span>
                ))}
              </div>
              {meetings.map((meeting) => (
                <MeetingTableRow
                  key={meeting.id}
                  meeting={meeting}
                  onUploaded={() => countUploadedRecording(meeting.id)}
                />
              ))}
            </div>

            <div className="lg:hidden">
              {meetings.map((meeting) => (
                <MeetingListRow
                  key={meeting.id}
                  meeting={meeting}
                  onUploaded={() => countUploadedRecording(meeting.id)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <CreateMeetingModal
        isOpen={isCreateOpen}
        onCreated={addCreatedMeeting}
        onOpenChange={setIsCreateOpen}
      />
    </div>
  );
}
