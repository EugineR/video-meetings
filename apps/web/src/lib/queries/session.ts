'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStoredUser, type StoredUser } from '@/lib/auth';

/** Cache key of the JWT-decoded signed-in user. See `useSessionQuery()`. */
export const sessionQueryKey = ['session'] as const;

export interface SessionQueryResult {
  /** The stored user, or `null` once the check resolved and found no valid token. */
  user: StoredUser | null;
  /** True until the first read of `localStorage` has resolved. */
  isPending: boolean;
}

/**
 * The signed-in user decoded from the stored JWT, as a query rather than component
 * state — so `applyAccessToken` (a password change reissues the token) can write the
 * new user straight into the cache with `setQueryData`.
 *
 * `getStoredUser()` reads `localStorage`, which exists only in the browser. A query
 * function never runs during render, so the server-rendered markup and the first
 * client render both show the pending state and cannot disagree; the read happens
 * after mount.
 *
 * `staleTime: Infinity` because nothing but this app writes the token: it is
 * re-read explicitly (`refetchQueries`) on every in-group navigation to catch an
 * expired token, and written explicitly on a token refresh.
 */
export function useSessionQuery(): SessionQueryResult {
  const { data, isPending } = useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => getStoredUser(),
    staleTime: Infinity,
  });

  return { user: data ?? null, isPending };
}

/**
 * Drops every cached query. Call it at a session boundary — signing in, signing out —
 * where the cache would otherwise carry one user's session and profile into the next
 * one, and where a cached "no valid token" answer would bounce a freshly signed-in
 * user back to `/login`.
 */
export function useResetQueryCache(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.clear(), [queryClient]);
}
