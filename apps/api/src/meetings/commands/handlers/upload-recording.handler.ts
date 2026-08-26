import { Logger, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { RecordingStatus } from '@prisma/client';
import {
  RecordingResponse,
  toRecordingResponse,
} from '../../interfaces/recording-response.interface';
import { MeetingsRepository } from '../../meetings.repository';
import {
  RecordingsRepository,
  UpdateRecordingStatusInput,
} from '../../recordings.repository';
import { StorageService } from '../../../storage/storage.service';
import { TranscriptionService } from '../../../transcription/transcription.service';
import { UploadRecordingCommand } from '../upload-recording.command';

@CommandHandler(UploadRecordingCommand)
export class UploadRecordingHandler implements ICommandHandler<
  UploadRecordingCommand,
  RecordingResponse
> {
  private readonly logger = new Logger(UploadRecordingHandler.name);

  constructor(
    private readonly meetingsRepository: MeetingsRepository,
    private readonly recordingsRepository: RecordingsRepository,
    private readonly storageService: StorageService,
    private readonly transcriptionService: TranscriptionService,
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

    const recording = await this.recordingsRepository.create({
      meetingId: command.meetingId,
      originalFilename: command.file.originalname,
      storagePath: command.file.path,
      mimeType: command.file.mimetype,
      sizeBytes: BigInt(command.file.size),
      status: RecordingStatus.UPLOADED,
    });

    // Based on the actual set of recordings for this meeting after the create
    // commits (not a pre-write snapshot), so a losing concurrent upload's file
    // is still cleaned up even though this handler never read its metadata.
    const currentRecordings = await this.recordingsRepository.findByMeetingId(
      command.meetingId,
    );
    await this.storageService.pruneMeetingDir(
      command.meetingId,
      currentRecordings.map((r) => r.storagePath),
    );

    // Fire-and-forget: transcription runs long enough that it must not block
    // this HTTP response. Errors are handled inside transcribeInBackground
    // (persisted as a FAILED status); this .catch only guards against an
    // unexpected throw escaping that method and becoming an unhandled rejection.
    this.transcribeInBackground(recording.id, recording.storagePath).catch(
      (err: unknown) => {
        this.logger.error(
          `Background transcription crashed for recording ${recording.id}`,
          err instanceof Error ? err.stack : err,
        );
      },
    );

    return toRecordingResponse(recording);
  }

  /**
   * Runs after the HTTP response, so the recording this run started for may already have been
   * deleted by the time each step below is ready to write — every write is conditioned on
   * `recordingId` still existing via `updateStatusIfCurrent`, which is a no-op once it doesn't.
   */
  private async transcribeInBackground(
    recordingId: string,
    storagePath: string,
  ): Promise<void> {
    const persistIfCurrent = (data: UpdateRecordingStatusInput) =>
      this.recordingsRepository.updateStatusIfCurrent(recordingId, data);

    const startedProcessing = await persistIfCurrent({
      status: RecordingStatus.PROCESSING,
    });
    if (!startedProcessing) {
      return;
    }

    try {
      const transcriptText =
        await this.transcriptionService.transcribe(storagePath);
      await persistIfCurrent({ status: RecordingStatus.READY, transcriptText });
    } catch (err) {
      this.logger.error(
        `Transcription failed for recording ${recordingId}`,
        err instanceof Error ? err.stack : err,
      );
      await persistIfCurrent({ status: RecordingStatus.FAILED });
    }
  }
}
