import { Avatar } from '@heroui/react';
import { getAvatarUrl } from '@/lib/api';

export type UserAvatarSize = 'header' | 'profile';

const HEROUI_SIZE: Record<UserAvatarSize, 'sm' | 'lg'> = {
  header: 'sm',
  profile: 'lg',
};

interface UserAvatarProps {
  name: string | null;
  email: string;
  hasAvatar: boolean;
  avatarUpdatedAt: string | null;
  size: UserAvatarSize;
}

/** Up to two initials from whitespace/punctuation-separated words, e.g. "Jane Doe" -> "JD". */
function initialsFrom(source: string): string {
  const words = source.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function getInitials(name: string | null, email: string): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return initialsFrom(trimmedName);
  }
  const [localPart] = email.split('@');
  return initialsFrom(localPart || email);
}

/**
 * The avatar image when the user has one; initials derived from their display
 * name, falling back to their email, otherwise. `Avatar.Image` (Radix under the
 * hood) hides itself and lets `Avatar.Fallback` show through on a load error, so
 * an avatar file that 404s (e.g. deleted between requests) degrades to initials
 * automatically.
 */
export function UserAvatar({
  name,
  email,
  hasAvatar,
  avatarUpdatedAt,
  size,
}: UserAvatarProps) {
  const label = name?.trim() || email;

  return (
    <Avatar color="accent" size={HEROUI_SIZE[size]} variant="soft">
      {hasAvatar ? (
        <Avatar.Image alt={label} src={getAvatarUrl(avatarUpdatedAt)} />
      ) : null}
      <Avatar.Fallback>{getInitials(name, email)}</Avatar.Fallback>
    </Avatar>
  );
}
