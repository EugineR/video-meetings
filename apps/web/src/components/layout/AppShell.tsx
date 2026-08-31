'use client';

import type { ReactNode } from 'react';
import { AppHeader } from '@/components/layout/AppHeader';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { PageShell } from '@/components/layout/PageShell';
import { useProfileQuery } from '@/lib/queries/profile';

interface AppShellProps {
  children: ReactNode;
}

/**
 * The chrome of every authenticated route: the gradient background, `AppHeader` fed
 * from the session context and the profile query, and the centered content container
 * pages render into. Used by `(app)/layout.tsx`, so a page contributes content only.
 *
 * This is also the profile query's permanent observer: it stays mounted for the whole
 * authenticated group, which is what keeps `GET /users/me` to one request per session
 * and the header's avatar from flickering back to initials on every navigation.
 */
export function AppShell({ children }: AppShellProps) {
  const { user, signOut } = useAuthenticatedUserContext();
  const { profile } = useProfileQuery();

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
