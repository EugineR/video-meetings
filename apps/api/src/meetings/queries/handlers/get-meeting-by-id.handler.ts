import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { MeetingSummary } from '@prisma/client';
import { GetMeetingSummaryQuery } from '../../../meeting-summary/queries/get-meeting-summary.query';
import {
  MeetingDetailResponse,
  toMeetingDetailResponse,
} from '../../interfaces/meeting-detail-response.interface';
import { MeetingsRepository } from '../../meetings.repository';
import { GetMeetingByIdQuery } from '../get-meeting-by-id.query';

@QueryHandler(GetMeetingByIdQuery)
export class GetMeetingByIdHandler implements IQueryHandler<
  GetMeetingByIdQuery,
  MeetingDetailResponse
> {
  constructor(
    private readonly meetingsRepository: MeetingsRepository,
    private readonly queryBus: QueryBus,
  ) {}

  async execute(query: GetMeetingByIdQuery): Promise<MeetingDetailResponse> {
    const meeting =
      await this.meetingsRepository.findByIdAndOwnerWithRecordings(
        query.id,
        query.ownerId,
      );
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // Cross-module read: meeting-summary/ owns this data, so it's reached via QueryBus rather
    // than importing its repository directly (MeetingsRepository stays a direct-declaration
    // repository since nothing outside meetings/ touches it — see apps/api/CLAUDE.md's CQRS
    // pattern).
    const summary = await this.queryBus.execute<
      GetMeetingSummaryQuery,
      MeetingSummary | null
    >(new GetMeetingSummaryQuery(meeting.id));

    return toMeetingDetailResponse(meeting, summary);
  }
}
