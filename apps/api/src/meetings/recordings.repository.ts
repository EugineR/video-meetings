import { Injectable } from '@nestjs/common';
import { MeetingRecording, RecordingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  delete(meetingId: string): Promise<MeetingRecording> {
    return this.prisma.meetingRecording.delete({ where: { meetingId } });
  }
}
