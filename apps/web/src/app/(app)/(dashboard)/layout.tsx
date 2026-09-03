'use client';

import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';

/**
 * Layout of the Meetwise dashboard redesign: `/` only. See `(app)/layout.tsx` for why this
 * is a separate route group from `(workspace)`.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
