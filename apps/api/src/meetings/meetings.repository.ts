import { Injectable } from '@nestjs/common';
import { Meeting, MeetingRecording } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A `Meeting` with its (at most one) recording relation loaded alongside it. */
export type MeetingWithRecording = Meeting & {
  recording: MeetingRecording | null;
};

@Injectable()
export class MeetingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    ownerId: string,
    title: string,
    date: string,
    participants: string[],
  ): Promise<Meeting> {
    return this.prisma.meeting.create({
      data: { ownerId, title, date: new Date(date), participants },
    });
  }

  findAllByOwner(ownerId: string): Promise<MeetingWithRecording[]> {
    return this.prisma.meeting.findMany({
      where: { ownerId },
      include: { recording: true },
    });
  }

  /** Ownership/existence check only — use `findByIdAndOwnerWithRecording` when the recording relation is actually needed. */
  findByIdAndOwner(id: string, ownerId: string): Promise<Meeting | null> {
    return this.prisma.meeting.findFirst({ where: { id, ownerId } });
  }

  findByIdAndOwnerWithRecording(
    id: string,
    ownerId: string,
  ): Promise<MeetingWithRecording | null> {
    return this.prisma.meeting.findFirst({
      where: { id, ownerId },
      include: { recording: true },
    });
  }
}
