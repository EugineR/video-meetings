'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';

/** `AppTopBar`'s per-page overrides — see `usePageHeader()`. */
export interface PageHeaderContent {
  breadcrumb?: string;
  title?: string;
}

const PageHeaderContext = createContext<
  ((header: PageHeaderContent) => void) | null
>(null);

interface PageHeaderProviderProps {
  children: ReactNode;
  setHeader: (header: PageHeaderContent) => void;
}

/**
 * Lets a page rendered inside `DashboardShell` override `AppTopBar`'s title/breadcrumb
 * while it is mounted. `DashboardShell` owns the header state (`useState`) and its own
 * `AppTopBar` render — both live above where `children` mounts — so a page cannot simply
 * pass props down to `AppTopBar` the way `DashboardShell` does; it announces its header
 * through this context instead. `DashboardShell` supplies `setHeader`, wrapping the
 * `children` it renders below its `AppTopBar`.
 */
export function PageHeaderProvider({
  children,
  setHeader,
}: PageHeaderProviderProps) {
  return (
    <PageHeaderContext.Provider value={setHeader}>
      {children}
    </PageHeaderContext.Provider>
  );
}

/**
 * Overrides `AppTopBar`'s title/breadcrumb for as long as the calling page stays mounted,
 * resetting to `DashboardShell`'s defaults when it unmounts. `/meetings/[id]` is the one
 * caller today, passing the meeting's title once loaded and a neutral fallback until then.
 */
export function usePageHeader({ breadcrumb, title }: PageHeaderContent): void {
  const setHeader = useContext(PageHeaderContext);
  if (!setHeader) {
    throw new Error('usePageHeader must be used inside DashboardShell');
  }

  useEffect(() => {
    setHeader({ breadcrumb, title });
    return () => setHeader({});
  }, [breadcrumb, setHeader, title]);
}
