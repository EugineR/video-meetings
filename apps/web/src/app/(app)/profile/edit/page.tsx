'use client';

import { Button, Card } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { useApplyProfile, useProfileQuery } from '@/lib/queries/profile';
import { AvatarSection } from '@/components/profile/AvatarSection';
import { DisplayNameSection } from '@/components/profile/DisplayNameSection';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

export default function ProfileEditPage() {
  const router = useRouter();
  const { applyAccessToken } = useAuthenticatedUserContext();
  const { profile, profileError } = useProfileQuery();
  const applyProfile = useApplyProfile();

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
            <ErrorText>{profileError}</ErrorText>
          </Card.Content>
        </Card>
      ) : profile === null ? (
        <LoadingState subject="profile" />
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
