import { Injectable } from '@nestjs/common';
import { MeetingRecording, Prisma, RecordingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma's "record to update/delete not found" error code. */
const PRISMA_NOT_FOUND_CODE = 'P2025';

export interface CreateOrReplaceRecordingInput {
  meetingId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: bigint;
  status: RecordingStatus;
}

@Injectable()
export class RecordingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createOrReplace(
    input: CreateOrReplaceRecordingInput,
  ): Promise<MeetingRecording> {
    const data = {
      originalFilename: input.originalFilename,
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: input.status,
    };

    return this.prisma.meetingRecording.upsert({
      where: { meetingId: input.meetingId },
      create: { meetingId: input.meetingId, ...data },
      update: data,
    });
  }

  findByMeetingId(meetingId: string): Promise<MeetingRecording | null> {
    return this.prisma.meetingRecording.findUnique({ where: { meetingId } });
  }

  /**
   * Deletes the recording row for a meeting, returning `null` (instead of
   * throwing) if it was already gone — e.g. a concurrent delete request won
   * the race — so callers can treat that as a normal "not found" rather than
   * an unhandled Prisma error.
   */
  async delete(meetingId: string): Promise<MeetingRecording | null> {
    try {
      return await this.prisma.meetingRecording.delete({
        where: { meetingId },
      });
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
