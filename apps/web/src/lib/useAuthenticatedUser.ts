'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearAccessToken,
  getStoredUser,
  refreshAccessToken,
  type StoredUser,
} from './auth';
import { ApiError, getProfile, type Profile } from './api';

export interface UseAuthenticatedUserResult {
  user: StoredUser | null;
  profile: Profile | null;
  /** Set if the `GET /users/me` request behind `profile` failed; `profile` then stays null. */
  profileError: string | null;
  signOut: () => void;
  /** Swaps in a freshly issued token (e.g. after a password change) without a re-login. */
  applyAccessToken: (token: string) => void;
  /**
   * Merges freshly saved fields (e.g. after a name change, or an avatar
   * upload/removal) into the current profile, without refetching. Takes a
   * `Partial<Profile>` and merges functionally against the latest state, so
   * an in-flight caller that captured a stale `profile` (e.g. a pending
   * avatar upload) can't clobber a concurrent update from another section.
   */
  applyProfile: (profile: Partial<Profile>) => void;
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
 * request resolves. This is the only place that fetches it — callers that
 * need it (e.g. the profile page) read it from here rather than issuing
 * their own request.
 */
export function useAuthenticatedUser(): UseAuthenticatedUserResult {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

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
      .catch((err: unknown) => {
        // A failed profile fetch leaves `profile` null; the header still has `user.email`.
        if (!cancelled) {
          setProfileError(
            err instanceof ApiError
              ? err.message
              : 'Could not load your profile. Please try again.',
          );
        }
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

  const applyProfile = useCallback((updatedProfile: Partial<Profile>) => {
    setProfile((prev) => (prev ? { ...prev, ...updatedProfile } : prev));
  }, []);

  return {
    user,
    profile,
    profileError,
    signOut,
    applyAccessToken,
    applyProfile,
  };
}
