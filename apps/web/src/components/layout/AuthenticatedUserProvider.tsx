'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { StoredUser } from '@/lib/auth';
import {
  useAuthenticatedUser,
  type UseAuthenticatedUserResult,
} from '@/lib/useAuthenticatedUser';
import { LoadingState } from '@/components/ui/LoadingState';

/**
 * What the `(app)` route group exposes to everything it renders. Identical to
 * `UseAuthenticatedUserResult` except that `user` is non-null: the provider holds the
 * guard, so nothing below it ever renders without a signed-in user.
 *
 * The profile is deliberately not here: it is a query (`lib/queries/profile.ts`) that
 * any component reads directly through `useProfileQuery()`.
 */
export type AuthenticatedUserContextValue = Omit<
  UseAuthenticatedUserResult,
  'user'
> & {
  user: StoredUser;
};

const AuthenticatedUserContext =
  createContext<AuthenticatedUserContextValue | null>(null);

interface AuthenticatedUserProviderProps {
  children: ReactNode;
}

/**
 * The single auth guard for the authenticated route group: `useAuthenticatedUser()`
 * redirects to `/login` when there is no valid stored session, and `user` stays null
 * until that client-side check resolves — which is the loading state rendered here,
 * once, instead of in every page.
 *
 * It also shares that session (`user`, `signOut`, `applyAccessToken`) with the whole
 * group, so the token check runs in one place rather than once per page.
 */
export function AuthenticatedUserProvider({
  children,
}: AuthenticatedUserProviderProps) {
  const { user, ...rest } = useAuthenticatedUser();

  if (!user) {
    return <LoadingState variant="page" />;
  }

  return (
    <AuthenticatedUserContext.Provider value={{ user, ...rest }}>
      {children}
    </AuthenticatedUserContext.Provider>
  );
}

/** Reads the signed-in session provided by `AuthenticatedUserProvider`. */
export function useAuthenticatedUserContext(): AuthenticatedUserContextValue {
  const value = useContext(AuthenticatedUserContext);
  if (!value) {
    throw new Error(
      'useAuthenticatedUserContext must be used inside AuthenticatedUserProvider',
    );
  }
  return value;
}
