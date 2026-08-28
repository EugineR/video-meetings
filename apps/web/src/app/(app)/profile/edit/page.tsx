'use client';

import { Button, Card, Spinner } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { AvatarSection } from '@/components/profile/AvatarSection';
import { DisplayNameSection } from '@/components/profile/DisplayNameSection';
import { PasswordSection } from '@/components/profile/PasswordSection';

export default function ProfileEditPage() {
  const router = useRouter();
  const { profile, profileError, applyProfile, applyAccessToken } =
    useAuthenticatedUserContext();

  return (
    <>
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
      ) : (
        <>
          <AvatarSection onProfileChange={applyProfile} profile={profile} />
          <DisplayNameSection name={profile.name} onSaved={applyProfile} />
          <PasswordSection onChanged={applyAccessToken} />
        </>
      )}
    </>
  );
}
