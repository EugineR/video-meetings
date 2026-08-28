'use client';

import type { ReactNode } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { PageShell } from '@/components/layout/PageShell';

interface AppShellProps {
  children: ReactNode;
}

/**
 * The chrome of every authenticated route: the gradient background, `AppHeader` fed
 * from the session context, and the centered content container pages render into.
 * Used by `(app)/layout.tsx`, so a page contributes content only.
 */
export function AppShell({ children }: AppShellProps) {
  const { user, profile, signOut } = useAuthenticatedUserContext();

  return (
    <PageShell>
      <AppHeader
        avatarUpdatedAt={profile?.avatarUpdatedAt}
        email={user.email}
        hasAvatar={profile?.hasAvatar}
        name={profile?.name}
        onSignOut={signOut}
      />
      <div className="flex justify-center px-4 py-12">
        <div className="flex w-full max-w-2xl flex-col gap-6">{children}</div>
      </div>
    </PageShell>
  );
}
