'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AuthenticatedUserProvider } from '@/components/layout/AuthenticatedUserProvider';

/**
 * Layout of the authenticated route group (`/`, `/meetings/[id]`, `/profile`,
 * `/profile/edit`): the auth guard and session state, then the shell (background,
 * header, content container). Pages below render their own content only.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedUserProvider>
      <AppShell>{children}</AppShell>
    </AuthenticatedUserProvider>
  );
}
