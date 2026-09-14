'use client';

import type { ReactNode } from 'react';

interface MeetingStatusBadgeProps {
  className?: string;
  isReady: boolean;
  pendingLabel: ReactNode;
  readyLabel: ReactNode;
  showDot?: boolean;
}

/**
 * The success/warning status pill `MeetingListRow`, `MeetingTableRow`, `RecentMeetingCard`
 * and the meeting detail page's header each render for a meeting-level ready/pending
 * state — a recording upload for the three list rows, transcription/summary settlement
 * (`isMeetingSettled()`) for the detail page — same tone and shape, with only the label
 * text and, on the two desktop-sized rows, a leading status dot the compact mobile row
 * omits, differing per call site. `className` carries each call site's own sizing
 * (padding, text size, `w-fit`/`shrink-0`); a label may itself carry a responsive
 * `hidden`/`lg:inline` pair when the wording differs by breakpoint.
 */
export function MeetingStatusBadge({
  className = '',
  isReady,
  pendingLabel,
  readyLabel,
  showDot = false,
}: MeetingStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[10px] font-semibold ${
        isReady
          ? 'bg-success-soft text-success'
          : 'bg-warning-soft text-warning'
      } ${className}`}
    >
      {showDot ? (
        <span
          className={`size-1.5 rounded-full ${isReady ? 'bg-success' : 'bg-warning'}`}
        />
      ) : null}
      {isReady ? readyLabel : pendingLabel}
    </span>
  );
}
