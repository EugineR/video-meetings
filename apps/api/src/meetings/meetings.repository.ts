import { Injectable } from '@nestjs/common';
import { Meeting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  findAllByOwner(ownerId: string): Promise<Meeting[]> {
    return this.prisma.meeting.findMany({ where: { ownerId } });
  }

  findByIdAndOwner(id: string, ownerId: string): Promise<Meeting | null> {
    return this.prisma.meeting.findFirst({ where: { id, ownerId } });
  }
}
