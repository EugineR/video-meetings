'use client';

import type { ReactNode } from 'react';
import { AuthMobileHeader } from '@/components/layout/AuthMobileHeader';
import { AuthStoryPanel } from '@/components/layout/AuthStoryPanel';
import { PageShell } from '@/components/layout/PageShell';

interface AuthShellProps {
  /**
   * The page's whole pane content: the switch-account prompt, the form and the legal
   * footer, stacked with `justify-between` — the page owns that composition (and the
   * per-page prompt/footer copy), the shell only owns the two-column chrome around it.
   */
  children: ReactNode;
}

/**
 * The chrome of the sign-in and registration routes: the dark marketing `AuthStoryPanel`
 * on desktop next to a plain white form pane (no `Card` — the design has the heading,
 * fields and footer sitting directly on the pane), still wrapped in `PageShell` so the
 * gradient invariant it documents ("both shells wrap it") keeps holding even though the
 * two full-height opaque panes here cover it completely. `AuthStoryPanel` doubles as the
 * page's branding, so there is no `BrandHeader` on these routes. Below `lg`, where there's
 * no room for the side panel, `AuthMobileHeader` takes over as a compact bar above the
 * form instead — the two are mutually exclusive via their own `hidden`/`lg:hidden` classes.
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <PageShell>
      <div className="flex flex-1 flex-col lg:flex-row">
        <AuthMobileHeader />
        <AuthStoryPanel />
        <div className="flex flex-1 flex-col items-center overflow-y-auto bg-surface px-6 py-8 sm:px-16">
          {children}
        </div>
      </div>
    </PageShell>
  );
}
