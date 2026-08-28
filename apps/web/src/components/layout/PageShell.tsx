import type { ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
}

/**
 * The full-height gradient background every route renders on. The gradient class
 * string lives here and nowhere else — both route-group shells (`AppShell`,
 * `AuthShell`) wrap their content in this component.
 */
export function PageShell({ children }: PageShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-linear-to-br from-accent/10 via-background to-background">
      {children}
    </div>
  );
}
