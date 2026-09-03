'use client';

import { useState } from 'react';
import type { Recording } from '@/lib/api';

export interface UseMeetingUploadModalOptions {
  meetingId: string;
  onUploaded: (recording: Recording) => void;
}

export interface MeetingUploadModal {
  /** Opens the dialog. */
  open: () => void;
  /** `UploadRecordingModal`'s own props, spread directly: `isOpen`, `meetingId`, `onOpenChange` and `onUploaded`. */
  isOpen: boolean;
  meetingId: string;
  onOpenChange: (isOpen: boolean) => void;
  onUploaded: (recording: Recording) => void;
}

/**
 * The open state and "close then bubble up" wiring every meeting row/card shares for its
 * `UploadRecordingModal` — `MeetingListRow`, `MeetingTableRow` and `RecentMeetingCard` each
 * used to hold this same `useState` and the same inline `onUploaded` closure independently.
 */
export function useMeetingUploadModal({
  meetingId,
  onUploaded,
}: UseMeetingUploadModalOptions): MeetingUploadModal {
  const [isOpen, setIsOpen] = useState(false);

  return {
    open: () => setIsOpen(true),
    isOpen,
    meetingId,
    onOpenChange: setIsOpen,
    onUploaded: (recording) => {
      setIsOpen(false);
      onUploaded(recording);
    },
  };
}
