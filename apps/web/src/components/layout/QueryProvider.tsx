'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queries/client';

interface QueryProviderProps {
  children: ReactNode;
}

/**
 * Mounts the app's single `QueryClient`, in the root layout so that both route
 * groups share one cache: signing in on `/login` has to be able to clear what the
 * previous session left behind.
 *
 * The client is created in state rather than at module scope — a module-level client
 * would be shared between requests on the server, leaking one user's data into
 * another's render.
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
