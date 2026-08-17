import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RecordingStatus } from '@prisma/client';
import {
  RecordingResponse,
  toRecordingResponse,
} from '../../interfaces/recording-response.interface';
import { MeetingsRepository } from '../../meetings.repository';
import { RecordingsRepository } from '../../recordings.repository';
import { StorageService } from '../../../storage/storage.service';
import { UploadRecordingCommand } from '../upload-recording.command';

@CommandHandler(UploadRecordingCommand)
export class UploadRecordingHandler implements ICommandHandler<
  UploadRecordingCommand,
  RecordingResponse
> {
  constructor(
    private readonly meetingsRepository: MeetingsRepository,
    private readonly recordingsRepository: RecordingsRepository,
    private readonly storageService: StorageService,
  ) {}

  async execute(command: UploadRecordingCommand): Promise<RecordingResponse> {
    const meeting = await this.meetingsRepository.findByIdAndOwner(
      command.meetingId,
      command.ownerId,
    );
    if (!meeting) {
      // The interceptor already wrote the file to disk before this handler
      // ran (multer runs before the route handler) — clean it up so a
      // rejected upload never leaves an orphaned file behind.
      await this.storageService.delete(command.file.path);
      throw new NotFoundException('Meeting not found');
    }

    const existing = await this.recordingsRepository.findByMeetingId(
      command.meetingId,
    );

    const recording = await this.recordingsRepository.createOrReplace({
      meetingId: command.meetingId,
      originalFilename: command.file.originalname,
      storagePath: command.file.path,
      mimeType: command.file.mimetype,
      sizeBytes: BigInt(command.file.size),
      status: RecordingStatus.UPLOADED,
    });

    if (existing) {
      await this.storageService.delete(existing.storagePath);
    }

    return toRecordingResponse(recording);
  }
}
