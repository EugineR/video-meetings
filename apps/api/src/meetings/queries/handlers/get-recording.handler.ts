import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { StorageService } from '../../../storage/storage.service';
import { RecordingContent } from '../../interfaces/recording-content.interface';
import { MeetingsRepository } from '../../meetings.repository';
import { parseRange } from '../../range-parser';
import { RecordingsRepository } from '../../recordings.repository';
import { GetRecordingQuery } from '../get-recording.query';

@QueryHandler(GetRecordingQuery)
export class GetRecordingHandler implements IQueryHandler<
  GetRecordingQuery,
  RecordingContent
> {
  constructor(
    private readonly meetingsRepository: MeetingsRepository,
    private readonly recordingsRepository: RecordingsRepository,
    private readonly storageService: StorageService,
  ) {}

  async execute(query: GetRecordingQuery): Promise<RecordingContent> {
    const meeting = await this.meetingsRepository.findByIdAndOwner(
      query.meetingId,
      query.ownerId,
    );
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    const recording = await this.recordingsRepository.findByMeetingId(
      query.meetingId,
    );
    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    const totalSize = Number(recording.sizeBytes);
    const range = parseRange(query.rangeHeader, totalSize);

    return {
      stream: this.storageService.createReadStream(
        recording.storagePath,
        range ?? undefined,
      ),
      mimeType: recording.mimeType,
      totalSize,
      range,
    };
  }
}
