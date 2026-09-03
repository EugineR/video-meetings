'use client';

interface MeetingStatusBadgeProps {
  className?: string;
  hasRecording: boolean;
  pendingLabel: string;
  readyLabel: string;
  showDot?: boolean;
}

/**
 * The success/warning status pill `MeetingListRow`, `MeetingTableRow` and
 * `RecentMeetingCard` each render for a meeting's recording state — same tone and shape,
 * with only the label text and, on the two desktop-sized rows, a leading status dot the
 * compact mobile row omits, differing per call site. `className` carries each call site's
 * own sizing (padding, text size, `w-fit`/`shrink-0`).
 */
export function MeetingStatusBadge({
  className = '',
  hasRecording,
  pendingLabel,
  readyLabel,
  showDot = false,
}: MeetingStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[10px] font-semibold ${
        hasRecording
          ? 'bg-success-soft text-success'
          : 'bg-warning-soft text-warning'
      } ${className}`}
    >
      {showDot ? (
        <span
          className={`size-1.5 rounded-full ${hasRecording ? 'bg-success' : 'bg-warning'}`}
        />
      ) : null}
      {hasRecording ? readyLabel : pendingLabel}
    </span>
  );
}
