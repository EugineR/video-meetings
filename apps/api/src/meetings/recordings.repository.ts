import { Injectable } from '@nestjs/common';
import { MeetingRecording, Prisma, RecordingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma's "record to update/delete not found" error code. */
const PRISMA_NOT_FOUND_CODE = 'P2025';

export interface CreateRecordingInput {
  meetingId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: bigint;
  status: RecordingStatus;
}

export interface UpdateRecordingStatusInput {
  status: RecordingStatus;
  transcriptText?: string | null;
}

@Injectable()
export class RecordingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateRecordingInput): Promise<MeetingRecording> {
    return this.prisma.meetingRecording.create({
      data: {
        meetingId: input.meetingId,
        originalFilename: input.originalFilename,
        storagePath: input.storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: input.status,
        transcriptText: null,
      },
    });
  }

  findByMeetingId(meetingId: string): Promise<MeetingRecording[]> {
    return this.prisma.meetingRecording.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** A single recording, scoped by both ids so a recording id can't be read/streamed/deleted through a different meeting's URL. */
  findById(
    meetingId: string,
    recordingId: string,
  ): Promise<MeetingRecording | null> {
    return this.prisma.meetingRecording.findFirst({
      where: { id: recordingId, meetingId },
    });
  }

  /**
   * Updates status/transcriptText for a recording, but only while it's still the same row this
   * write started for — matched by `recordingId` alone. Matching by `id` is sufficient now that
   * `create` always gives a recording a fresh, permanent id (there is no upsert-in-place keeping
   * an id stable across a replace, the way `storagePath` used to have to stand in for identity).
   * Returns `false` without writing anything if the recording has since been deleted, so a
   * background transcription run started for a since-removed file can never clobber another row.
   */
  async updateStatusIfCurrent(
    recordingId: string,
    data: UpdateRecordingStatusInput,
  ): Promise<boolean> {
    const result = await this.prisma.meetingRecording.updateMany({
      where: { id: recordingId },
      data,
    });
    return result.count > 0;
  }

  /**
   * Deletes one recording row, scoped by both `meetingId` and `recordingId`, returning `null`
   * (instead of throwing) if it was already gone — e.g. a concurrent delete request won the race,
   * or the id belongs to a different meeting — so callers can treat that as a normal "not found"
   * rather than an unhandled Prisma error.
   */
  async delete(
    meetingId: string,
    recordingId: string,
  ): Promise<MeetingRecording | null> {
    const recording = await this.prisma.meetingRecording.findFirst({
      where: { id: recordingId, meetingId },
    });
    if (!recording) {
      return null;
    }

    try {
      return await this.prisma.meetingRecording.delete({
        where: { id: recordingId },
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
