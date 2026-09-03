'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Layout of the original chrome: `/meetings/[id]`, `/profile`, `/profile/edit` — the
 * gradient background, `AppHeader` and centered content container, unchanged by the
 * dashboard redesign. See `(app)/layout.tsx` for why this is its own route group.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
