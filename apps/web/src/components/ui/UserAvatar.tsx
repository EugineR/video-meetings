'use client';

import { Avatar } from '@heroui/react';
import { getAvatarUrl } from '@/lib/api';
import { getInitials } from '@/lib/format';

export type UserAvatarSize = 'header' | 'profile';

const HEROUI_SIZE: Record<UserAvatarSize, 'sm' | 'lg'> = {
  header: 'sm',
  profile: 'lg',
};

interface UserAvatarProps {
  avatarUpdatedAt: string | null;
  email: string;
  hasAvatar: boolean;
  name: string | null;
  size: UserAvatarSize;
}

/**
 * The avatar image when the user has one; initials derived from their display
 * name, falling back to their email, otherwise. `Avatar.Image` (Radix under the
 * hood) hides itself and lets `Avatar.Fallback` show through on a load error, so
 * an avatar file that 404s (e.g. deleted between requests) degrades to initials
 * automatically.
 *
 * A shared primitive rather than a profile component: `layout/AppHeader` renders it
 * on every authenticated route, so keeping it in `components/profile/` pointed the
 * header at a feature folder.
 */
export function UserAvatar({
  avatarUpdatedAt,
  email,
  hasAvatar,
  name,
  size,
}: UserAvatarProps) {
  const label = name?.trim() || email;

  return (
    // Keyed on `hasAvatar`: Radix's Avatar tracks image-loading status on the
    // root and never resets it when `Avatar.Image` unmounts, so without a key
    // change a removed avatar would leave the root stuck reporting "loaded"
    // and the fallback initials would never render.
    <Avatar
      color="accent"
      key={hasAvatar ? 'image' : 'fallback'}
      size={HEROUI_SIZE[size]}
      variant="soft"
    >
      {hasAvatar ? (
        <Avatar.Image alt={label} src={getAvatarUrl(avatarUpdatedAt)} />
      ) : null}
      <Avatar.Fallback>{getInitials(name, email)}</Avatar.Fallback>
    </Avatar>
  );
}
