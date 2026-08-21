'use client';

import { Button, Card, Spinner } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useAuthenticatedUser } from '@/lib/useAuthenticatedUser';
import { AppHeader } from '@/components/layout/AppHeader';

export default function ProfileEditPage() {
  const router = useRouter();
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
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Edit profile</h2>
            <Button
              className="h-11 md:h-10"
              variant="secondary"
              onPress={() => router.push('/profile')}
            >
              Back to profile
            </Button>
          </div>
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
