'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Chip } from '@heroui/react';
import type { MeetingListItem } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  CalendarIcon,
  UploadIcon,
  UsersIcon,
  VideoCameraIcon,
} from '@/components/icons';
import { UploadRecordingModal } from './UploadRecordingModal';

interface MeetingRowProps {
  meeting: MeetingListItem;
  highlighted?: boolean;
  onUploaded?: (meetingId: string) => void;
}

export function MeetingRow({
  meeting,
  highlighted,
  onUploaded,
}: MeetingRowProps) {
  const router = useRouter();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  return (
    <li
      className={`rounded-lg border px-4 py-3 ${
        highlighted
          ? 'border-accent/30 bg-accent/10'
          : 'border-default-200 bg-default-50'
      }`}
    >
      <button
        className="block w-full cursor-pointer text-left"
        onClick={() => router.push(`/meetings/${meeting.id}`)}
        type="button"
      >
        <p className="font-medium">{meeting.title}</p>
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
      </button>

      <div className="mt-2 flex">
        {meeting.hasRecording ? (
          <Chip color="success" size="sm" variant="soft">
            <VideoCameraIcon className="size-3.5" />
            <Chip.Label>Recording</Chip.Label>
          </Chip>
        ) : (
          <Button
            className="h-11 md:h-10"
            onPress={() => setIsUploadOpen(true)}
            variant="secondary"
          >
            <UploadIcon className="size-4" />
            Upload
          </Button>
        )}
      </div>

      <UploadRecordingModal
        isOpen={isUploadOpen}
        meetingId={meeting.id}
        onOpenChange={setIsUploadOpen}
        onUploaded={() => {
          setIsUploadOpen(false);
          onUploaded?.(meeting.id);
        }}
      />
    </li>
  );
}
