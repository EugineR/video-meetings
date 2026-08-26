import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { MeetingsRepository } from '../../meetings.repository';
import { RecordingsRepository } from '../../recordings.repository';
import { StorageService } from '../../../storage/storage.service';
import { DeleteRecordingCommand } from '../delete-recording.command';

@CommandHandler(DeleteRecordingCommand)
export class DeleteRecordingHandler implements ICommandHandler<
  DeleteRecordingCommand,
  void
> {
  constructor(
    private readonly meetingsRepository: MeetingsRepository,
    private readonly recordingsRepository: RecordingsRepository,
    private readonly storageService: StorageService,
  ) {}

  async execute(command: DeleteRecordingCommand): Promise<void> {
    const meeting = await this.meetingsRepository.findByIdAndOwner(
      command.meetingId,
      command.ownerId,
    );
    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    const recording = await this.recordingsRepository.delete(
      command.meetingId,
      command.recordingId,
    );
    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    await this.storageService.delete(recording.storagePath);
  }
}
