'use client';

import { Dropdown, Link } from '@heroui/react';
import type { MeetingListItem, Recording } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMeetingUploadModal } from '@/lib/useMeetingUploadModal';
import { EllipsisVerticalIcon, VideoCameraIcon } from '@/components/icons';
import { MeetingStatusBadge } from '@/components/meetings/MeetingStatusBadge';
import { UploadRecordingModal } from '@/components/meetings/UploadRecordingModal';

interface MeetingListRowProps {
  meeting: MeetingListItem;
  onUploaded: (recording: Recording) => void;
}

/**
 * Mobile "All meetings" row (`lg:hidden`) — see `MeetingTableRow`, its desktop equivalent,
 * including why the actions cell's `Dropdown.Trigger` is a fixed `w-[22px]` instead of
 * `touchTarget()`.
 */
export function MeetingListRow({ meeting, onUploaded }: MeetingListRowProps) {
  const upload = useMeetingUploadModal({ meetingId: meeting.id, onUploaded });
  const hasRecording = meeting.recordingCount > 0;

  return (
    <div className="relative flex h-[60px] items-center gap-2.5 border-b border-border px-3 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-tile">
        <VideoCameraIcon
          aria-hidden="true"
          className="size-[15px] text-foreground"
        />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          className="truncate text-xs font-semibold text-foreground after:absolute after:inset-0 focus-visible:outline-none"
          href={`/meetings/${meeting.id}`}
        >
          {meeting.title}
        </Link>
        <p className="truncate text-[10px] text-muted">
          {formatDateTime(meeting.date)} · {meeting.recordingCount} file
          {meeting.recordingCount === 1 ? '' : 's'}
        </p>
      </div>

      <MeetingStatusBadge
        className="shrink-0 px-1.5 py-1 text-[9px]"
        hasRecording={hasRecording}
        pendingLabel="Needs upload"
        readyLabel="Uploaded"
      />

      <div className="relative flex w-[22px] shrink-0 justify-center">
        {hasRecording ? (
          <EllipsisVerticalIcon
            aria-hidden="true"
            className="size-4 text-(--field-placeholder)"
          />
        ) : (
          <Dropdown>
            <Dropdown.Trigger
              aria-label="Meeting actions"
              className="flex w-[22px] shrink-0 cursor-pointer items-center justify-center text-(--field-placeholder)"
            >
              <EllipsisVerticalIcon className="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Item id="upload" onAction={upload.open}>
                  Upload recording
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        )}
      </div>

      <UploadRecordingModal {...upload} />
    </div>
  );
}
