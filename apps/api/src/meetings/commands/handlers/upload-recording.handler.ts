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
import { MeetingSummaryService } from '../../../meeting-summary/meeting-summary.service';
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
    private readonly meetingSummaryService: MeetingSummaryService,
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
    this.transcribeInBackground(
      recording.id,
      recording.meetingId,
      recording.storagePath,
    ).catch((err: unknown) => {
      this.logger.error(
        `Background transcription crashed for recording ${recording.id}`,
        err instanceof Error ? err.stack : err,
      );
    });

    return toRecordingResponse(recording);
  }

  /**
   * Runs after the HTTP response, so the recording this run started for may already have been
   * deleted by the time each step below is ready to write — every write is conditioned on
   * `recordingId` still existing via `updateStatusIfCurrent`, which is a no-op once it doesn't.
   */
  private async transcribeInBackground(
    recordingId: string,
    meetingId: string,
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

    // Fire-and-forget, mirroring the outer call site: summary generation must not add LLM
    // latency to this background transcription run either. Errors are handled inside
    // reconcileSummary/generateForMeeting (persisted as a FAILED summary status); this .catch
    // only guards against an unexpected throw escaping it and becoming an unhandled rejection.
    //
    // Triggered on both READY and FAILED — not just READY — because a meeting's summary can only
    // settle to its final status once every one of its recordings is terminal, and that terminal
    // recording is not always the one that succeeds: if it's this one and it FAILED, nothing else
    // will ever trigger the check that flips an existing, already-successful summary from PENDING
    // to READY.
    this.reconcileSummary(meetingId).catch((err: unknown) => {
      this.logger.error(
        `Background summary reconciliation crashed for meeting ${meetingId}`,
        err instanceof Error ? err.stack : err,
      );
    });
  }

  /**
   * Re-derives the meeting's summarization inputs fresh from the database — rather than trusting
   * whatever this specific recording's own transcription run just computed — and hands them to
   * `MeetingSummaryService.generateForMeeting`: every `READY` recording's transcript, ordered by
   * `MeetingRecording.createdAt` (the same ordering `RecordingsRepository.findByMeetingId` already
   * uses), `FAILED` ones excluded, plus whether every recording of the meeting has now reached a
   * terminal status. Re-deriving fresh also means a recording deleted in the meantime is simply
   * absent from the list rather than needing special-casing here.
   */
  private async reconcileSummary(meetingId: string): Promise<void> {
    const recordings =
      await this.recordingsRepository.findByMeetingId(meetingId);

    const readyTranscripts = recordings
      .filter((r) => r.status === RecordingStatus.READY)
      .map((r) => r.transcriptText)
      .filter((text): text is string => text !== null);

    const allRecordingsTerminal = recordings.every(
      (r) =>
        r.status === RecordingStatus.READY ||
        r.status === RecordingStatus.FAILED,
    );

    await this.meetingSummaryService.generateForMeeting(
      meetingId,
      readyTranscripts,
      allRecordingsTerminal,
    );
  }
}
