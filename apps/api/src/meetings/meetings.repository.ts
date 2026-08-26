import { Injectable } from '@nestjs/common';
import { Meeting, MeetingRecording } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A `Meeting` with its recordings relation loaded alongside it. */
export type MeetingWithRecordings = Meeting & {
  recordings: MeetingRecording[];
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

  findAllByOwner(ownerId: string): Promise<MeetingWithRecordings[]> {
    return this.prisma.meeting.findMany({
      where: { ownerId },
      include: { recordings: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /** Ownership/existence check only — use `findByIdAndOwnerWithRecordings` when the recordings relation is actually needed. */
  findByIdAndOwner(id: string, ownerId: string): Promise<Meeting | null> {
    return this.prisma.meeting.findFirst({ where: { id, ownerId } });
  }

  findByIdAndOwnerWithRecordings(
    id: string,
    ownerId: string,
  ): Promise<MeetingWithRecordings | null> {
    return this.prisma.meeting.findFirst({
      where: { id, ownerId },
      include: { recordings: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
