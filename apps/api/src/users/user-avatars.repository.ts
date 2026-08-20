import { Injectable } from '@nestjs/common';
import { Prisma, UserAvatar } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma's "record to update/delete not found" error code. */
const PRISMA_NOT_FOUND_CODE = 'P2025';

export interface CreateOrReplaceAvatarInput {
  userId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: bigint;
}

@Injectable()
export class UserAvatarsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<UserAvatar | null> {
    return this.prisma.userAvatar.findUnique({ where: { userId } });
  }

  createOrReplace(input: CreateOrReplaceAvatarInput): Promise<UserAvatar> {
    const data = {
      originalFilename: input.originalFilename,
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    };

    return this.prisma.userAvatar.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, ...data },
      update: data,
    });
  }

  /**
   * Deletes the avatar row for a user, returning `null` (instead of
   * throwing) if it was already gone — e.g. a concurrent delete request won
   * the race — so callers can treat that as a normal "not found" rather than
   * an unhandled Prisma error. Mirrors `RecordingsRepository.delete`.
   */
  async delete(userId: string): Promise<UserAvatar | null> {
    try {
      return await this.prisma.userAvatar.delete({ where: { userId } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_NOT_FOUND_CODE
      ) {
        return null;
      }
      throw err;
    }
  }
}
