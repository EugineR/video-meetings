import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { MeetingsRepository } from '../../meetings.repository';
import { RecordingsRepository } from '../../recordings.repository';
import { SummaryReconciliationService } from '../../summary-reconciliation.service';
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
    private readonly summaryReconciliationService: SummaryReconciliationService,
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

    // Fire-and-forget, mirroring UploadRecordingHandler: a deleted recording can change what the
    // meeting's summary should be based on regardless of that recording's own status — it may
    // have been the transcript a READY summary was (partly) built from (which must not linger
    // once its source is gone), or the last non-terminal recording still blocking an otherwise
    // complete summary from settling to READY. SummaryReconciliationService re-derives the
    // meeting's current recordings itself and handles its own error logging/ordering.
    this.summaryReconciliationService.reconcile(command.meetingId);
  }
}
