'use client';

import type { ReactNode } from 'react';
import { AuthenticatedUserProvider } from '@/components/layout/AuthenticatedUserProvider';

/**
 * Layout of the authenticated route group: the auth guard and session state only. Visual
 * chrome is owned one level down, by whichever child route group a page falls into —
 * `(dashboard)` (`/`, the new Meetwise sidebar/top-bar shell) or `(workspace)`
 * (`/meetings/[id]`, `/profile`, `/profile/edit`, the original `AppShell` header). Splitting
 * there, instead of here, is what let the dashboard redesign replace `/`'s chrome without
 * touching the other three routes' — Next.js gives sibling routes different layouts only
 * across a folder boundary, and `/` used to be a direct sibling of `meetings`/`profile`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedUserProvider>{children}</AuthenticatedUserProvider>;
}
