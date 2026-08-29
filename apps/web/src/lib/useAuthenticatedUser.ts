'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { clearAccessToken, refreshAccessToken, type StoredUser } from './auth';
import {
  sessionQueryKey,
  useResetQueryCache,
  useSessionQuery,
} from './queries/session';

export interface UseAuthenticatedUserResult {
  user: StoredUser | null;
  signOut: () => void;
  /** Swaps in a freshly issued token (e.g. after a password change) without a re-login. */
  applyAccessToken: (token: string) => void;
}

/**
 * The token half of the client-side session: it redirects to /login when there is no
 * valid stored token (client-side only — see auth.ts), and otherwise exposes the user
 * decoded from that token plus the two ways it can change — signing out, and a
 * reissued token. `user` stays null until the check resolves.
 *
 * It owns the token concern only. The profile lives in its own query
 * (`lib/queries/profile.ts`), which any component may read; this hook neither fetches
 * nor holds it.
 *
 * It is called in exactly one place — `AuthenticatedUserProvider` — which turns
 * "`user` is still null" into the group's single guard screen.
 *
 * The provider lives in a layout, which Next.js does not remount on navigation inside
 * the group, so the stored-token check is re-run on every `pathname` change —
 * otherwise an expired token would only be caught on a full page load. The re-read
 * returns an equal object for an unchanged session, and the query cache's structural
 * sharing keeps the previous reference, so navigating never invalidates anything
 * downstream.
 */
export function useAuthenticatedUser(): UseAuthenticatedUserResult {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const resetQueryCache = useResetQueryCache();
  const { user, isPending } = useSessionQuery();

  // Re-read the stored token on every in-group navigation: this hook's owner sits in a
  // layout Next.js keeps mounted, so without this an expired token would go unnoticed.
  useEffect(() => {
    void queryClient.refetchQueries({ queryKey: sessionQueryKey });
  }, [pathname, queryClient]);

  useEffect(() => {
    if (!isPending && !user) {
      router.replace('/login');
    }
  }, [isPending, user, router]);

  const signOut = () => {
    clearAccessToken();
    // Nothing of this session may survive the sign-out. Dropping the token alone would
    // not be enough: the cached session is `staleTime: Infinity`, so navigating back to
    // an authenticated route within its `gcTime` would render the group from the stale
    // user — and fire its tokenless requests — before the re-read redirects to /login.
    resetQueryCache();
    router.replace('/login');
  };

  const applyAccessToken = useCallback(
    (token: string) => {
      queryClient.setQueryData<StoredUser | null>(
        sessionQueryKey,
        refreshAccessToken(token),
      );
    },
    [queryClient],
  );

  return { user, signOut, applyAccessToken };
}
