'use client';

import { Dropdown, Link } from '@heroui/react';
import type { MeetingListItem, Recording } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMeetingUploadModal } from '@/lib/useMeetingUploadModal';
import {
  EllipsisIcon,
  PaperclipIcon,
  VideoCameraIcon,
} from '@/components/icons';
import { MeetingStatusBadge } from '@/components/meetings/MeetingStatusBadge';
import { UploadRecordingModal } from '@/components/meetings/UploadRecordingModal';

interface MeetingTableRowProps {
  meeting: MeetingListItem;
  onUploaded: (recording: Recording) => void;
}

/**
 * One row of the desktop "All meetings" table (`hidden lg:block` — `MeetingListRow` is the
 * mobile equivalent). The design draws a distinct icon per row implying a meeting category
 * the API doesn't have; every row uses the same icon instead of fabricating one.
 *
 * The design's row has no visible "Upload" control, only a "..." actions affordance — since
 * uploading is existing functionality, its trigger moved into that menu rather than being
 * dropped (only shown while the meeting has no recording; there is nothing else for the
 * menu to offer yet).
 *
 * Stretched-link pattern on the meeting cell, same as `MeetingRow`/`RecentMeetingCard` —
 * the actions cell is a later, `relative` sibling so it stays clickable above the overlay.
 *
 * The actions cell's `Dropdown.Trigger` is sized to the design's 28px column directly rather
 * than through `touchTarget()`: the column is a fixed `size-7`, and wrapping the trigger to
 * the 44px/40px minimum instead made a row with a recording (a plain, smaller decorative
 * icon) and one without (the trigger) misalign — same 44px/40px-vs-compact-design trade-off
 * as `RecentMeetingCard`'s quick-action pill.
 */
export function MeetingTableRow({ meeting, onUploaded }: MeetingTableRowProps) {
  const upload = useMeetingUploadModal({ meetingId: meeting.id, onUploaded });
  const hasRecording = meeting.recordingCount > 0;

  return (
    <div className="relative flex h-14 items-center border-b border-border px-4 last:border-b-0">
      <div className="flex flex-1 items-center gap-2.5">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-tile">
          <VideoCameraIcon
            aria-hidden="true"
            className="size-[15px] text-foreground"
          />
        </span>
        <Link
          className="text-xs font-semibold text-foreground after:absolute after:inset-0 focus-visible:outline-none"
          href={`/meetings/${meeting.id}`}
        >
          {meeting.title}
        </Link>
      </div>

      <p className="w-[145px] shrink-0 text-[11px] text-muted">
        {formatDateTime(meeting.date)}
      </p>

      <p className="w-[170px] shrink-0 truncate text-[11px] text-muted">
        {meeting.participants.length > 0
          ? meeting.participants.join(', ')
          : 'No participants'}
      </p>

      <div
        className={`flex w-[90px] shrink-0 items-center gap-1.5 text-[10px] font-medium ${
          hasRecording ? 'text-accent-strong' : 'text-muted'
        }`}
      >
        <PaperclipIcon aria-hidden="true" className="size-3" />
        {meeting.recordingCount} file{meeting.recordingCount === 1 ? '' : 's'}
      </div>

      <div className="w-[130px] shrink-0">
        <MeetingStatusBadge
          className="px-2 py-1 text-[10px]"
          hasRecording={hasRecording}
          pendingLabel="Needs upload"
          readyLabel="Uploaded"
          showDot
        />
      </div>

      <div className="relative flex w-7 shrink-0 justify-center">
        {hasRecording ? (
          <EllipsisIcon
            aria-hidden="true"
            className="size-[18px] text-(--field-placeholder)"
          />
        ) : (
          <Dropdown>
            <Dropdown.Trigger
              aria-label="Meeting actions"
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center text-(--field-placeholder)"
            >
              <EllipsisIcon className="size-[18px]" />
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
