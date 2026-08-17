'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearAccessToken, getStoredUser, type StoredUser } from './auth';

export interface UseAuthenticatedUserResult {
  user: StoredUser | null;
  signOut: () => void;
}

/**
 * Shared by every page that requires a signed-in user: redirects to /login
 * when there's no valid stored user (client-side only — see auth.ts),
 * otherwise exposes that user plus a signOut() that clears the token and
 * redirects. `user` stays null until the check resolves, which callers use
 * as their own "auth check pending" loading state.
 */
export function useAuthenticatedUser(): UseAuthenticatedUserResult {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) {
      router.replace('/login');
      return;
    }
    // localStorage is only available client-side, so this must run in an effect rather than during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(storedUser);
  }, [router]);

  const signOut = () => {
    clearAccessToken();
    router.replace('/login');
  };

  return { user, signOut };
}
