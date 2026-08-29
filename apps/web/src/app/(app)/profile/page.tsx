'use client';

import { Card } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useProfileQuery } from '@/lib/queries/profile';
import { formatDateTime } from '@/lib/format';
import { CalendarIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { ErrorText } from '@/components/ui/ErrorText';
import { LoadingState } from '@/components/ui/LoadingState';

export default function ProfilePage() {
  const router = useRouter();
  const { profile, profileError } = useProfileQuery();

  if (profileError) {
    return (
      <Card>
        <Card.Content>
          <ErrorText>{profileError}</ErrorText>
        </Card.Content>
      </Card>
    );
  }

  if (profile === null) {
    return <LoadingState subject="profile" />;
  }

  return (
    <Card>
      <Card.Header className="flex flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <UserAvatar
            avatarUpdatedAt={profile.avatarUpdatedAt}
            email={profile.email}
            hasAvatar={profile.hasAvatar}
            name={profile.name}
            size="profile"
          />
          <Card.Title render={(props) => <h2 {...props} />}>
            {profile.name?.trim() || profile.email}
          </Card.Title>
        </div>
        <Button
          className="shrink-0"
          onPress={() => router.push('/profile/edit')}
          variant="secondary"
        >
          Edit profile
        </Button>
      </Card.Header>
      <Card.Content className="flex flex-col gap-1.5">
        <p className="text-sm text-muted">{profile.email}</p>
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <CalendarIcon aria-hidden="true" className="size-4 shrink-0" />
          Joined {formatDateTime(profile.createdAt)}
        </p>
      </Card.Content>
    </Card>
  );
}
