import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { MeetingSummary } from '@prisma/client';
import { MeetingSummaryRepository } from '../../meeting-summary.repository';
import { GetMeetingSummaryQuery } from '../get-meeting-summary.query';

@QueryHandler(GetMeetingSummaryQuery)
export class GetMeetingSummaryHandler implements IQueryHandler<
  GetMeetingSummaryQuery,
  MeetingSummary | null
> {
  constructor(
    private readonly meetingSummaryRepository: MeetingSummaryRepository,
  ) {}

  execute(query: GetMeetingSummaryQuery): Promise<MeetingSummary | null> {
    return this.meetingSummaryRepository.findByMeetingId(query.meetingId);
  }
}
