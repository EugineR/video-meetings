'use client';

import { Button, Link } from '@heroui/react';
import { BrandHeader } from '@/components/layout/BrandHeader';
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
      <Link className="flex items-center gap-2 rounded-lg py-1" href="/profile">
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
      <Button className="h-11 md:h-10" onPress={onSignOut} variant="secondary">
        Sign out
      </Button>
    </BrandHeader>
  );
}
