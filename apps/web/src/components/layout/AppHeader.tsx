import { Button } from '@heroui/react';
import { VideoCameraIcon } from '@/components/icons';

interface AppHeaderProps {
  email?: string;
  onSignOut?: () => void;
}

export function AppHeader({ email, onSignOut }: AppHeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-default-200 bg-background px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <VideoCameraIcon aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h1 className="text-base font-semibold leading-tight">
            Video Meetings
          </h1>
          {email ? (
            <p className="text-xs leading-tight text-muted">{email}</p>
          ) : null}
        </div>
      </div>
      {onSignOut ? (
        <Button
          className="h-11 md:h-10"
          variant="secondary"
          onPress={onSignOut}
        >
          Sign out
        </Button>
      ) : null}
    </header>
  );
}
