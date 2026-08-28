import type { ReactNode } from 'react';
import { BrandHeader } from '@/components/layout/BrandHeader';
import { PageShell } from '@/components/layout/PageShell';

interface AuthShellProps {
  children: ReactNode;
}

/**
 * The chrome of the sign-in and registration routes: the same gradient background as
 * the authenticated shell, the brand-only header (there is no user to show yet) and
 * the centered card slot the pages render their `Card` into.
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <PageShell>
      <BrandHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </PageShell>
  );
}
