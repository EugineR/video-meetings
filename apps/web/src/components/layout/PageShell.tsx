'use client';

import type { ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
}

/**
 * The full-height gradient background `AppShell` (`(workspace)`) and `AuthShell` render
 * on. The gradient class string lives here and nowhere else. `DashboardShell` (`/`) does
 * not use it: the Meetwise dashboard design's background is a flat color, not this gradient.
 */
export function PageShell({ children }: PageShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-linear-to-br from-accent/10 via-background to-background">
      {children}
    </div>
  );
}
