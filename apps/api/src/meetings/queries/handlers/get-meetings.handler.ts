import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Meeting } from '@prisma/client';
import { MeetingsRepository } from '../../meetings.repository';
import { GetMeetingsQuery } from '../get-meetings.query';

@QueryHandler(GetMeetingsQuery)
export class GetMeetingsHandler implements IQueryHandler<
  GetMeetingsQuery,
  Meeting[]
> {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  execute(query: GetMeetingsQuery): Promise<Meeting[]> {
    return this.meetingsRepository.findAllByOwner(query.ownerId);
  }
}
