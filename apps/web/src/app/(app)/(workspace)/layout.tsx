'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Layout of the original chrome: `/profile`, `/profile/edit` — the gradient background,
 * `AppHeader` and centered content container, unchanged by the dashboard redesign.
 * `/meetings/[id]` moved to `(dashboard)` (the Meetwise sidebar/top-bar shell) — see
 * `(app)/layout.tsx` for why this is its own route group.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
