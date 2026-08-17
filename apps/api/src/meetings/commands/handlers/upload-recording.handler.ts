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

    const recording = await this.recordingsRepository.createOrReplace({
      meetingId: command.meetingId,
      originalFilename: command.file.originalname,
      storagePath: command.file.path,
      mimeType: command.file.mimetype,
      sizeBytes: BigInt(command.file.size),
      status: RecordingStatus.UPLOADED,
    });

    // Based on the actual directory contents after the DB upsert commits
    // (not a pre-upsert snapshot), so a losing concurrent upload's file is
    // still cleaned up even though this handler never read its metadata.
    await this.storageService.pruneMeetingDir(
      command.meetingId,
      recording.storagePath,
    );

    return toRecordingResponse(recording);
  }
}
