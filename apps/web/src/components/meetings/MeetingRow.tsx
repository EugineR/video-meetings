'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Chip } from '@heroui/react';
import type { MeetingListItem, Recording } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  CalendarIcon,
  UploadIcon,
  UsersIcon,
  VideoCameraIcon,
} from '@/components/icons';
import { UploadRecordingModal } from '@/components/meetings/UploadRecordingModal';
import { Button } from '@/components/ui/Button';

interface MeetingRowProps {
  /** Blue-tinted treatment for the "Recent meetings" list. */
  highlighted?: boolean;
  meeting: MeetingListItem;
  /**
   * The recording the row's upload modal just stored — the same payload
   * `RecordingUploader` and `UploadRecordingModal` hand up, so `onUploaded` means one
   * thing everywhere. The caller already knows which meeting the row is for.
   */
  onUploaded: (recording: Recording) => void;
}

/**
 * One meeting in the list: a card whose title, date and participant lines all open the
 * meeting, plus an "Upload" control for a meeting that has no recording yet.
 *
 * It is the card-with-a-stretched-link pattern rather than the `<button onClick>` wrapping
 * the row's `<p>`s that it replaced. That button was interactive markup wrapping block
 * content, it navigated with `router.push` so the row could not be opened in a new tab or
 * middle-clicked, and its accessible name was the whole card read out at once. Here the
 * only tab stops are the title link and the "Upload" button: the link's `::after` covers
 * the card so the meta lines stay clickable without being part of the link's name. The
 * action row is `relative`, which lifts it back above that overlay so the "Upload" press
 * lands on the button — and that strip spans the card's full width, so the empty space
 * beside the chip or the button is deliberately not part of the link either. Nothing is
 * nested inside anything else.
 */
export function MeetingRow({
  highlighted,
  meeting,
  onUploaded,
}: MeetingRowProps) {
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  return (
    <li
      className={`relative rounded-lg border px-4 py-3 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent ${
        highlighted
          ? 'border-accent/30 bg-accent/10'
          : 'border-default-200 bg-default-50'
      }`}
    >
      <Link
        className="font-medium after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
        href={`/meetings/${meeting.id}`}
      >
        {meeting.title}
      </Link>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <CalendarIcon aria-hidden="true" className="size-4 shrink-0" />
        {formatDateTime(meeting.date)}
      </p>
      {meeting.participants.length > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <UsersIcon aria-hidden="true" className="size-4 shrink-0" />
          {meeting.participants.join(', ')}
        </p>
      ) : null}

      <div className="relative mt-2 flex">
        {meeting.recordingCount > 0 ? (
          <Chip color="success" size="sm" variant="soft">
            <VideoCameraIcon className="size-3.5" />
            <Chip.Label>
              {meeting.recordingCount} file
              {meeting.recordingCount === 1 ? '' : 's'}
            </Chip.Label>
          </Chip>
        ) : (
          <Button onPress={() => setIsUploadOpen(true)} variant="secondary">
            <UploadIcon className="size-4" />
            Upload
          </Button>
        )}
      </div>

      <UploadRecordingModal
        isOpen={isUploadOpen}
        meetingId={meeting.id}
        onOpenChange={setIsUploadOpen}
        onUploaded={(recording) => {
          setIsUploadOpen(false);
          onUploaded(recording);
        }}
      />
    </li>
  );
}
