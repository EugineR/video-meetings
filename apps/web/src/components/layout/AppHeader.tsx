import { Button, Link } from '@heroui/react';
import { VideoCameraIcon } from '@/components/icons';
import { UserAvatar } from '@/components/profile/UserAvatar';

interface AppHeaderProps {
  email?: string;
  name?: string | null;
  hasAvatar?: boolean;
  avatarUpdatedAt?: string | null;
  onSignOut?: () => void;
}

export function AppHeader({
  email,
  name = null,
  hasAvatar = false,
  avatarUpdatedAt = null,
  onSignOut,
}: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-default-200 bg-background px-4 py-3 sm:px-6">
      <Link className="flex items-center gap-2 rounded-lg py-1" href="/">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <VideoCameraIcon aria-hidden="true" className="size-5" />
        </span>
        <h1 className="text-base font-semibold leading-tight">
          Video Meetings
        </h1>
      </Link>
      <div className="flex items-center gap-3">
        {email ? (
          <Link
            className="flex items-center gap-2 rounded-lg py-1"
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
        ) : null}
        {onSignOut ? (
          <Button
            className="h-11 md:h-10"
            variant="secondary"
            onPress={onSignOut}
          >
            Sign out
          </Button>
        ) : null}
      </div>
    </header>
  );
}
