'use client';

import { AppErrorState } from '@/components/layout/AppErrorState';

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** See `AppErrorState` — keeps `DashboardShell` (sidebar/top bar) mounted during the error. */
export default function DashboardError({ error, reset }: DashboardErrorProps) {
  return <AppErrorState error={error} reset={reset} />;
}
