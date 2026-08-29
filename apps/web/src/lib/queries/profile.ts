'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, getProfile, type Profile } from '@/lib/api';

/** Cache key of `GET /users/me`. See `useProfileQuery()`. */
export const profileQueryKey = ['profile'] as const;

export interface ProfileQueryResult {
  /** The profile, or `null` while it is still loading or the request failed. */
  profile: Profile | null;
  /** Set if `GET /users/me` failed; `profile` then stays null. */
  profileError: string | null;
}

/**
 * The signed-in user's profile, fetched once per session and shared by every
 * consumer: the header (`AppShell`), `/profile` and `/profile/edit`.
 *
 * `staleTime: Infinity` is what makes that "once": the header keeps an observer
 * mounted for as long as the authenticated group is, so navigating between the
 * pages hits the cache instead of refetching — no second `GET /users/me`, and no
 * header flickering from initials back to the avatar on every navigation. Nothing
 * else changes the profile, so every save writes the result into the cache through
 * `useApplyProfile()` rather than invalidating it.
 */
export function useProfileQuery(): ProfileQueryResult {
  const { data, error } = useQuery({
    queryKey: profileQueryKey,
    queryFn: getProfile,
    staleTime: Infinity,
  });

  return {
    profile: data ?? null,
    // A failed profile fetch leaves `profile` null; the header still has `user.email`.
    profileError: error
      ? error instanceof ApiError
        ? error.message
        : 'Could not load your profile. Please try again.'
      : null,
  };
}

/**
 * What a `/profile/edit` section hands back after a successful save — the one payload
 * shape behind the one callback name (`onSaved`) all three of them use. Every field is
 * optional because a section reports only what it actually changed: the display name and
 * the avatar produce a `profile` delta, the password change produces a reissued
 * `accessToken`, and the page applies whichever half arrives (`useApplyProfile()` here,
 * `applyAccessToken` from the session context).
 *
 * `profile` is a delta rather than a whole `Profile` on purpose: a save can resolve well
 * after it read the profile — an avatar upload has its own progress bar — by which point
 * another section may have saved a newer one, and a whole profile built from the stale
 * copy would clobber that update. See `useApplyProfile()` below.
 */
export interface ProfileSaved {
  /** A freshly issued token, when the save invalidated the previous one. */
  accessToken?: string;
  /** Only the profile fields the save changed. */
  profile?: Partial<Profile>;
}

/**
 * Merges freshly saved fields (a name change, an avatar upload or removal) into the
 * cached profile, so every consumer picks them up without a refetch.
 *
 * It takes a `Partial<Profile>` and merges against whatever is in the cache at the
 * moment it runs, not against a profile captured earlier: a caller can resolve well
 * after it read the profile (an avatar upload has its own progress bar), by which
 * point another section may have saved a newer one, and writing a whole `Profile`
 * built from the stale copy would clobber that update.
 */
export function useApplyProfile(): (profile: Partial<Profile>) => void {
  const queryClient = useQueryClient();

  return useCallback(
    (updatedProfile: Partial<Profile>) => {
      queryClient.setQueryData<Profile>(profileQueryKey, (previous) =>
        previous ? { ...previous, ...updatedProfile } : previous,
      );
    },
    [queryClient],
  );
}
