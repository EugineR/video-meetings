'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearAccessToken,
  getStoredUser,
  refreshAccessToken,
  type StoredUser,
} from './auth';
import { getProfile, type Profile } from './api';

export interface UseAuthenticatedUserResult {
  user: StoredUser | null;
  profile: Profile | null;
  signOut: () => void;
  /** Swaps in a freshly issued token (e.g. after a password change) without a re-login. */
  applyAccessToken: (token: string) => void;
}

/**
 * Shared by every page that requires a signed-in user: redirects to /login
 * when there's no valid stored user (client-side only — see auth.ts),
 * otherwise exposes that user plus a signOut() that clears the token and
 * redirects. `user` stays null until the check resolves, which callers use
 * as their own "auth check pending" loading state.
 *
 * `user` is the JWT-decoded email, available immediately so the header can
 * render before the network round-trip completes; `profile` is the
 * `GET /users/me` result (name, avatar presence) and stays null until that
 * request resolves.
 */
export function useAuthenticatedUser(): UseAuthenticatedUserResult {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

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

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    getProfile()
      .then((fetchedProfile) => {
        if (!cancelled) {
          setProfile(fetchedProfile);
        }
      })
      .catch(() => {
        // A failed profile fetch leaves `profile` null; the header still has `user.email`.
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const signOut = () => {
    clearAccessToken();
    router.replace('/login');
  };

  const applyAccessToken = useCallback((token: string) => {
    setUser(refreshAccessToken(token));
  }, []);

  return { user, profile, signOut, applyAccessToken };
}
