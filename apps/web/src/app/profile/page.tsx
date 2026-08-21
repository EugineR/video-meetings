'use client';

import { Card, Spinner } from '@heroui/react';
import { useAuthenticatedUser } from '@/lib/useAuthenticatedUser';
import { formatDateTime } from '@/lib/format';
import { AppHeader } from '@/components/layout/AppHeader';
import { CalendarIcon } from '@/components/icons';
import { UserAvatar } from '@/components/profile/UserAvatar';

export default function ProfilePage() {
  const { user, profile, profileError, signOut } = useAuthenticatedUser();

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-linear-to-br from-accent/10 via-background to-background">
      <AppHeader
        avatarUpdatedAt={profile?.avatarUpdatedAt}
        email={user.email}
        hasAvatar={profile?.hasAvatar}
        name={profile?.name}
        onSignOut={signOut}
      />
      <div className="flex justify-center px-4 py-12">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          {profileError ? (
            <Card>
              <Card.Content>
                <p className="text-sm text-danger" role="alert">
                  {profileError}
                </p>
              </Card.Content>
            </Card>
          ) : profile === null ? (
            <div className="flex justify-center py-12">
              <Spinner aria-label="Loading profile" />
            </div>
          ) : (
            <Card>
              <Card.Header className="flex flex-row items-center gap-4">
                <UserAvatar
                  avatarUpdatedAt={profile.avatarUpdatedAt}
                  email={profile.email}
                  hasAvatar={profile.hasAvatar}
                  name={profile.name}
                  size="profile"
                />
                <Card.Title>{profile.name?.trim() || profile.email}</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-1.5">
                <p className="text-sm text-muted">{profile.email}</p>
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <CalendarIcon
                    aria-hidden="true"
                    className="size-4 shrink-0"
                  />
                  Joined {formatDateTime(profile.createdAt)}
                </p>
              </Card.Content>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
