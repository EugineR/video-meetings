'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
 * The client-side session behind the authenticated route group: redirects to
 * /login when there's no valid stored user (client-side only — see auth.ts),
 * otherwise exposes that user plus a signOut() that clears the token and
 * redirects. `user` stays null until the check resolves.
 *
 * It is called in exactly one place — `AuthenticatedUserProvider` — which turns
 * "`user` is still null" into the group's single guard screen and shares the
 * rest with the header and the pages through context. A page must not call it
 * again: that would fetch `GET /users/me` a second time into a private copy of
 * the profile the header would never see updated.
 *
 * The provider lives in a layout, which Next.js does not remount on navigation
 * inside the group, so the stored-token check is re-run on every `pathname`
 * change — otherwise an expired token would only be caught on a full page load.
 *
 * `user` is the JWT-decoded email, available immediately so the header can
 * render before the network round-trip completes; `profile` is the
 * `GET /users/me` result (name, avatar presence) and stays null until that
 * request resolves.
 */
export function useAuthenticatedUser(): UseAuthenticatedUserResult {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    const storedUser = getStoredUser();
    if (!storedUser) {
      // localStorage is only available client-side, so this must run in an effect rather than during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUser(null);
      router.replace('/login');
      return;
    }
    // Keep the previous object while the session is unchanged: this effect re-runs on
    // every in-group navigation, and a fresh object would refetch the profile each time.
    setUser((previous) =>
      previous?.email === storedUser.email ? previous : storedUser,
    );
  }, [pathname, router]);

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
