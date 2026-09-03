'use client';

import type { CSSProperties } from 'react';
import { Link } from '@heroui/react';
import type { MeetingListItem, Recording } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMeetingUploadModal } from '@/lib/useMeetingUploadModal';
import {
  CalendarIcon,
  PaperclipIcon,
  SparklesIcon,
  UploadIcon,
} from '@/components/icons';
import { MeetingStatusBadge } from '@/components/meetings/MeetingStatusBadge';
import { UploadRecordingModal } from '@/components/meetings/UploadRecordingModal';

interface RecentMeetingCardProps {
  meeting: MeetingListItem;
  onUploaded: (recording: Recording) => void;
}

/**
 * One card in the home page's "Recent meetings" grid. Two states depending on
 * `recordingCount`: "Recording needed" opens the same `UploadRecordingModal` a plain
 * all-meetings row does; "Summary ready" links to the meeting instead of fabricating an
 * "open summary" shortcut the API has no data to back beyond what that link already does.
 *
 * The participants line stands in for the design's meeting description, which has no
 * backing field on `Meeting` — same substitution `MeetingRow` used to make.
 *
 * The quick-action pill is one of the design's two dedicated small button variants —
 * `J7yV4r` (Button / Primary / Small) for "Open summary", `Fu4mT` (Button / Secondary /
 * Small) for "Upload recording", both `$radius-7`/`gap-6`/`px-10`/11px-600 typography, only
 * the fill, foreground and height (32px ready / 26px pending) differing per variant. Each is
 * a plain element rather than `@/components/ui/Button`, deliberately below the 44px/40px
 * touch-target minimum: the card itself is already a full-size stretched-link tap target,
 * this pill is a small secondary shortcut inside it, and the design's own compact size is
 * what was reported as a visual bug when it rendered at the touch-target height instead.
 *
 * "Open summary"'s `Link` sets `color` via an inline `style`, not a `text-*` className: this
 * app's own `a { color: inherit }` in `globals.css` is unlayered CSS, which — per the CSS
 * Cascade Layers spec — beats *any* layered rule outright regardless of specificity, including
 * both HeroUI's `.link` (`@layer components`) and every Tailwind `text-*` utility (`@layer
 * utilities`). That reset is deliberate everywhere else (the stretched-link title reads in the
 * surrounding ink color, not link-blue), so the fix for this one exceptional Link isn't a
 * stronger class — no class can outrank an unlayered rule — it's an inline style, the one thing
 * with higher precedence than any stylesheet rule. "Upload recording" needs no such style: it's
 * a plain `<button>`, not an `<a>`, so the `a { color: inherit }` reset never applies to it.
 *
 * Stretched-link pattern: the title `Link`'s `::after` covers the whole (`relative`) card,
 * and the action row is a later, `relative` sibling so it paints above that overlay and
 * stays clickable — see the pattern this replaces, `MeetingRow`'s doc comment (git history).
 */
export function RecentMeetingCard({
  meeting,
  onUploaded,
}: RecentMeetingCardProps) {
  const upload = useMeetingUploadModal({ meetingId: meeting.id, onUploaded });
  const hasRecording = meeting.recordingCount > 0;

  return (
    <div className="relative flex flex-col justify-between gap-2 rounded-[10px] border border-border bg-surface p-[13px] lg:p-[18px]">
      <div className="flex flex-col gap-2">
        <MeetingStatusBadge
          className="w-fit px-2 py-1 text-[10px]"
          hasRecording={hasRecording}
          pendingLabel="Recording needed"
          readyLabel="Summary ready"
          showDot
        />

        <Link
          className="font-head text-base font-semibold text-foreground after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none lg:text-lg"
          href={`/meetings/${meeting.id}`}
        >
          {meeting.title}
        </Link>

        {meeting.participants.length > 0 ? (
          <p className="text-[11px] text-muted lg:text-xs">
            {meeting.participants.join(', ')}
          </p>
        ) : null}
      </div>

      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted lg:text-[11px]">
          <CalendarIcon
            aria-hidden="true"
            className="size-3 shrink-0 lg:size-3.5"
          />
          <span className="truncate">{formatDateTime(meeting.date)}</span>
          <span aria-hidden="true" className="text-muted-strong">
            ·
          </span>
          <PaperclipIcon
            aria-hidden="true"
            className="size-3 shrink-0 lg:size-3.5"
          />
          <span className="shrink-0 font-medium">
            {meeting.recordingCount} file
            {meeting.recordingCount === 1 ? '' : 's'}
          </span>
        </div>

        {hasRecording ? (
          <Link
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] bg-accent-strong px-2.5 text-[11px] font-semibold"
            href={`/meetings/${meeting.id}`}
            style={{ color: 'var(--action-fg)' } satisfies CSSProperties}
          >
            <SparklesIcon aria-hidden="true" className="size-3.5" />
            Open summary
          </Link>
        ) : (
          <button
            className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] bg-accent-soft px-2.5 text-[11px] font-semibold text-accent-strong"
            onClick={upload.open}
            type="button"
          >
            <UploadIcon aria-hidden="true" className="size-3.5" />
            Upload recording
          </button>
        )}
      </div>

      <UploadRecordingModal {...upload} />
    </div>
  );
}
