import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Meeting } from '@prisma/client';
import { MeetingsRepository } from '../../meetings.repository';
import { GetMeetingByIdQuery } from '../get-meeting-by-id.query';

@QueryHandler(GetMeetingByIdQuery)
export class GetMeetingByIdHandler implements IQueryHandler<
  GetMeetingByIdQuery,
  Meeting
> {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  async execute(query: GetMeetingByIdQuery): Promise<Meeting> {
    const meeting = await this.meetingsRepository.findByIdAndOwner(
      query.id,
      query.ownerId,
    );
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    return meeting;
  }
}
