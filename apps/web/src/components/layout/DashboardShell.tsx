'use client';

import { useState, type ReactNode } from 'react';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { MobileNavDrawer } from '@/components/layout/MobileNavDrawer';
import { MobileTopBar } from '@/components/layout/MobileTopBar';
import { useProfileQuery } from '@/lib/queries/profile';

interface DashboardShellProps {
  children: ReactNode;
}

/**
 * The chrome of the dashboard route group (`/`): the Meetwise sidebar/top-bar redesign,
 * fed from the same session context and profile query `AppShell` uses for the original
 * chrome. Used by `(dashboard)/layout.tsx`, so `page.tsx` contributes content only — see
 * `(app)/layout.tsx` for why this is a separate shell from `AppShell` rather than a variant
 * of it.
 *
 * Owns the mobile nav drawer's open state: it is the one piece of this chrome that is real
 * interaction rather than markup-only mockup (`MobileTopBar`'s menu button opens it,
 * `MobileNavDrawer`'s backdrop and close button close it).
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const { user, signOut } = useAuthenticatedUserContext();
  const { profile } = useProfileQuery();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const name = profile?.name ?? null;

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:flex">
        <AppSidebar email={user.email} name={name} onSignOut={signOut} />
      </div>

      <div className="flex min-h-screen flex-1 flex-col pb-[76px] lg:pb-0">
        <div className="hidden lg:block">
          <AppTopBar />
        </div>
        <div className="lg:hidden">
          <MobileTopBar onOpenMenu={() => setIsMenuOpen(true)} />
        </div>

        <main className="flex-1">{children}</main>
      </div>

      <div className="fixed inset-x-0 bottom-0 lg:hidden">
        <MobileBottomNav />
      </div>

      <MobileNavDrawer
        email={user.email}
        isOpen={isMenuOpen}
        name={name}
        onOpenChange={setIsMenuOpen}
        onSignOut={signOut}
      />
    </div>
  );
}
