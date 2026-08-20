import { UserAvatar } from '@prisma/client';

/** `UserAvatar` with `sizeBytes` serialized to a JSON-safe string (raw `BigInt` throws in `res.json()`). */
export type AvatarResponse = Omit<UserAvatar, 'sizeBytes'> & {
  sizeBytes: string;
};

export function toAvatarResponse(avatar: UserAvatar): AvatarResponse {
  return { ...avatar, sizeBytes: avatar.sizeBytes.toString() };
}
