import { User } from '@prisma/client';

export interface ProfileResponse {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export function toProfileResponse(user: User): ProfileResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}
