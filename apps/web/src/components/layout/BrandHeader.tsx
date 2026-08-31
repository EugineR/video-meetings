'use client';

import type { ReactNode } from 'react';
import { Link } from '@heroui/react';
import { VideoCameraIcon } from '@/components/icons';

interface BrandHeaderProps {
  /** Right-hand slot: the signed-in user's controls, empty on the auth routes. */
  children?: ReactNode;
}

/**
 * The header bar with the app's logo and name, linking back to `/`. Rendered on its
 * own by the `(auth)` shell — sign-in and registration have no user to show — and
 * with the user controls in its slot by `AppHeader`.
 */
export function BrandHeader({ children }: BrandHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-default-200 bg-background px-4 py-3 sm:px-6">
      <Link className="flex items-center gap-2 rounded-lg py-1" href="/">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <VideoCameraIcon aria-hidden="true" className="size-5" />
        </span>
        <h1 className="text-base font-semibold leading-tight">
          Video Meetings
        </h1>
      </Link>
      <div className="flex items-center gap-3">{children}</div>
    </header>
  );
}
