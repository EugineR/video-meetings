'use client';

import { Link } from '@heroui/react';
import { touchTarget } from '@/lib/touchTarget';
import { BrandHeader } from '@/components/layout/BrandHeader';
import { Button } from '@/components/ui/Button';
import { UserAvatar } from '@/components/ui/UserAvatar';

interface AppHeaderProps {
  avatarUpdatedAt?: string | null;
  email: string;
  hasAvatar?: boolean;
  name?: string | null;
  onSignOut: () => void;
}

/**
 * The header of every authenticated route: the brand bar plus the signed-in user's
 * avatar/name (linking to `/profile`) and a sign-out control. Rendered once, by
 * `AppShell`; a page that renders it itself is a bug.
 */
export function AppHeader({
  avatarUpdatedAt = null,
  email,
  hasAvatar = false,
  name = null,
  onSignOut,
}: AppHeaderProps) {
  return (
    <BrandHeader>
      {/* A link, but a standalone control rather than inline text, so it takes the same
          touch target as the button beside it — which already sets the row's height, so
          filling it costs no extra space. */}
      <Link
        className={touchTarget({
          className: 'flex items-center gap-2 rounded-lg py-1',
          fit: 'block',
        })}
        href="/profile"
      >
        <UserAvatar
          avatarUpdatedAt={avatarUpdatedAt}
          email={email}
          hasAvatar={hasAvatar}
          name={name}
          size="header"
        />
        <span className="text-xs leading-tight text-muted">
          {name?.trim() || email}
        </span>
      </Link>
      <Button onPress={onSignOut} variant="secondary">
        Sign out
      </Button>
    </BrandHeader>
  );
}
