'use client';

import { getInitials } from '@/lib/format';

/** Shared with `MeetingSummarySection`'s action-item assignee avatars — same deterministic
 * index-based tinting, no per-name color lookup to keep in sync. */
export const AVATAR_TINTS = [
  'bg-avatar-warm text-avatar-warm-foreground',
  'bg-avatar-cool text-avatar-cool-foreground',
  'bg-avatar-purple text-avatar-purple-foreground',
  'bg-avatar-green text-avatar-green-foreground',
] as const;

const MAX_VISIBLE_AVATARS = 3;

export type ParticipantAvatarsSize = 'compact' | 'default';

const SIZE_CLASSES: Record<
  ParticipantAvatarsSize,
  { avatar: string; overlap: string; text: string }
> = {
  compact: {
    avatar: 'size-[30px]',
    overlap: '-ml-[6px]',
    text: 'text-[10px]',
  },
  default: { avatar: 'size-[34px]', overlap: '-ml-[7px]', text: 'text-xs' },
};

interface ParticipantAvatarsProps {
  participants: string[];
  size?: ParticipantAvatarsSize;
}

/**
 * Overlapping initials-avatar row for a meeting's participants (design components
 * `o15d3T` "Avatar / Initial" and `JLHn6` "Avatar Group / Overflow", used together in
 * `zN1db`/`MSwyt`): up to `MAX_VISIBLE_AVATARS` circles tinted by index through the
 * existing `bg-avatar-*` tokens, then a "+N" tile in the shared `bg-tile`/`text-muted`
 * pair once there are more. Purely presentational — `participants` stays the plain
 * string list `MeetingDetail` already carries; the tint per name is derived from its
 * index (not the mock's own third color, which has no matching token), so it stays
 * deterministic without adding a new data source.
 */
export function ParticipantAvatars({
  participants,
  size = 'default',
}: ParticipantAvatarsProps) {
  const visible = participants.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = participants.length - visible.length;
  const { avatar, overlap, text } = SIZE_CLASSES[size];

  return (
    <div className="flex shrink-0 items-center">
      {visible.map((participant, index) => (
        <span
          className={`flex ${avatar} shrink-0 items-center justify-center rounded-full border-2 border-surface font-head font-semibold ${text} ${AVATAR_TINTS[index % AVATAR_TINTS.length]} ${index === 0 ? '' : overlap}`}
          key={`${participant}-${index}`}
        >
          {getInitials(participant, participant)}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className={`flex ${avatar} shrink-0 items-center justify-center rounded-full border-2 border-surface bg-tile font-head font-semibold text-muted ${text} ${overlap}`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
