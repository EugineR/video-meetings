import { User, UserAvatar } from '@prisma/client';

export interface ProfileResponse {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  hasAvatar: boolean;
  avatarUpdatedAt: Date | null;
}

export function toProfileResponse(
  user: User,
  avatar: UserAvatar | null,
): ProfileResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    hasAvatar: avatar !== null,
    avatarUpdatedAt: avatar?.updatedAt ?? null,
  };
}
