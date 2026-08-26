import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
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
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  async execute(query: GetMeetingByIdQuery): Promise<MeetingDetailResponse> {
    const meeting =
      await this.meetingsRepository.findByIdAndOwnerWithRecordings(
        query.id,
        query.ownerId,
      );
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    return toMeetingDetailResponse(meeting);
  }
}
