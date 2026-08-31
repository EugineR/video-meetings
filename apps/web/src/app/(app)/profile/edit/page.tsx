'use client';

import { Card } from '@heroui/react';
import { useRouter } from 'next/navigation';
import {
  useApplyProfile,
  useProfileQuery,
  type ProfileSaved,
} from '@/lib/queries/profile';
import { useAuthenticatedUserContext } from '@/components/layout/AuthenticatedUserProvider';
import { AvatarSection } from '@/components/profile/AvatarSection';
import { DisplayNameSection } from '@/components/profile/DisplayNameSection';
import { PasswordSection } from '@/components/profile/PasswordSection';
import { Button } from '@/components/ui/Button';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

export default function ProfileEditPage() {
  const router = useRouter();
  const { applyAccessToken } = useAuthenticatedUserContext();
  const { profile, profileError } = useProfileQuery();
  const applyProfile = useApplyProfile();

  /**
   * The one place the sections' shared `onSaved` payload is applied: a `profile` delta
   * goes into the query cache, a reissued `accessToken` into the session. A section
   * fills only the half it produced, so both branches are conditional.
   */
  const handleSaved = ({
    accessToken,
    profile: savedProfile,
  }: ProfileSaved) => {
    if (savedProfile) {
      applyProfile(savedProfile);
    }
    if (accessToken) {
      applyAccessToken(accessToken);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Edit profile</h2>
        <Button onPress={() => router.push('/profile')} variant="secondary">
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
          <AvatarSection onSaved={handleSaved} profile={profile} />
          <DisplayNameSection name={profile.name} onSaved={handleSaved} />
          <PasswordSection onSaved={handleSaved} />
        </>
      )}
    </>
  );
}
