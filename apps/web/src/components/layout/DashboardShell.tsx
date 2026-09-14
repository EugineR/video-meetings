'use client';

import { useState, type ReactNode } from 'react';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { AppTopBar } from '@/components/layout/AppTopBar';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { MobileNavDrawer } from '@/components/layout/MobileNavDrawer';
import { MobileTopBar } from '@/components/layout/MobileTopBar';
import {
  PageHeaderProvider,
  type PageHeaderContent,
} from '@/components/layout/PageHeaderProvider';
import { useProfileQuery } from '@/lib/queries/profile';

interface DashboardShellProps {
  children: ReactNode;
}

/**
 * The chrome of the dashboard route group (`/`, `/meetings/[id]`): the Meetwise
 * sidebar/top-bar redesign, fed from the same session context and profile query `AppShell`
 * uses for the original chrome. Used by `(dashboard)/layout.tsx`, so a page contributes
 * content only — see `(app)/layout.tsx` for why this is a separate shell from `AppShell`
 * rather than a variant of it.
 *
 * Owns two pieces of real state: the mobile nav drawer's open flag (`MobileTopBar`'s menu
 * button opens it, `MobileNavDrawer`'s backdrop and close button close it), and `AppTopBar`'s
 * title/breadcrumb — a page below wraps that override through `usePageHeader()`
 * (`PageHeaderProvider.tsx`) rather than this shared, non-remounting shell taking per-route
 * props it has no way to receive from a layout that mounts it once for every dashboard
 * route.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const { user, signOut } = useAuthenticatedUserContext();
  const { profile } = useProfileQuery();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [header, setHeader] = useState<PageHeaderContent>({});

  const name = profile?.name ?? null;

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden lg:flex">
        <AppSidebar email={user.email} name={name} onSignOut={signOut} />
      </div>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-[76px] lg:pb-0">
        <div className="hidden lg:block">
          <AppTopBar breadcrumb={header.breadcrumb} title={header.title} />
        </div>
        <div className="lg:hidden">
          <MobileTopBar onOpenMenu={() => setIsMenuOpen(true)} />
        </div>

        <main className="flex-1">
          <PageHeaderProvider setHeader={setHeader}>
            {children}
          </PageHeaderProvider>
        </main>
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
