'use client';

import { AppErrorState } from '@/components/layout/AppErrorState';

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Fallback for an error thrown by the `(app)` group's own `layout.tsx` (the auth guard) —
 * `(dashboard)/error.tsx` and `(workspace)/error.tsx` catch everything below that, each
 * keeping its own shell mounted. See `AppErrorState`.
 */
export default function AppError({ error, reset }: AppErrorProps) {
  return <AppErrorState error={error} reset={reset} />;
}
