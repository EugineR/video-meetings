'use client';

import { AppErrorState } from '@/components/layout/AppErrorState';

interface WorkspaceErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** See `AppErrorState` — keeps `AppShell` (header) mounted during the error. */
export default function WorkspaceError({ error, reset }: WorkspaceErrorProps) {
  return <AppErrorState error={error} reset={reset} />;
}
