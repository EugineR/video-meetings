import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
  MeetingListItemResponse,
  toMeetingListItemResponse,
} from '../../interfaces/meeting-list-item-response.interface';
import { MeetingsRepository } from '../../meetings.repository';
import { GetMeetingsQuery } from '../get-meetings.query';

@QueryHandler(GetMeetingsQuery)
export class GetMeetingsHandler implements IQueryHandler<
  GetMeetingsQuery,
  MeetingListItemResponse[]
> {
  constructor(private readonly meetingsRepository: MeetingsRepository) {}

  async execute(query: GetMeetingsQuery): Promise<MeetingListItemResponse[]> {
    const meetings = await this.meetingsRepository.findAllByOwner(
      query.ownerId,
    );
    return meetings.map(toMeetingListItemResponse);
  }
}
