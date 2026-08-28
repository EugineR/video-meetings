import { Injectable, Logger } from '@nestjs/common';
import { RecordingStatus } from '@prisma/client';
import { MeetingSummaryService } from '../meeting-summary/meeting-summary.service';
import { RecordingsRepository } from './recordings.repository';

/**
 * Re-derives a meeting's summarization inputs fresh from the database and hands them to
 * `MeetingSummaryService.generateForMeeting` — shared by every write that can change which
 * recordings a meeting's summary should be based on: a recording finishing transcription
 * (`UploadRecordingHandler`) or a recording being deleted (`DeleteRecordingHandler`).
 *
 * Runs for a given meeting are chained one after another rather than fired concurrently: two
 * recordings of the same meeting can finish transcribing moments apart, each triggering a
 * reconciliation independently, and `MeetingSummaryRepository`'s matched-on-current-row writes only
 * guard against the meeting/row having been deleted mid-run — they do nothing to stop a slower run
 * (started from an earlier, smaller snapshot of the meeting's recordings) from finishing after a
 * faster one and overwriting its more complete result, which can wedge the summary at `PENDING`
 * forever once every recording has actually gone terminal. Chaining per `meetingId` means each run
 * always starts from the freshest database state and there is never more than one in flight.
 */
@Injectable()
export class SummaryReconciliationService {
  private readonly logger = new Logger(SummaryReconciliationService.name);
  private readonly queuedRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly recordingsRepository: RecordingsRepository,
    private readonly meetingSummaryService: MeetingSummaryService,
  ) {}

  /**
   * Fire-and-forget: queues a reconciliation run after any already-queued one for the same
   * meeting. Errors are logged here rather than thrown, so one failed run never breaks the chain
   * for runs queued after it.
   */
  reconcile(meetingId: string): void {
    const previousRun = this.queuedRuns.get(meetingId) ?? Promise.resolve();
    const thisRun = previousRun
      .catch(() => undefined)
      .then(() => this.run(meetingId))
      .catch((err: unknown) => {
        this.logger.error(
          `Background summary reconciliation crashed for meeting ${meetingId}`,
          err instanceof Error ? err.stack : err,
        );
      });

    this.queuedRuns.set(meetingId, thisRun);
    // thisRun's own .catch above means it always resolves, never rejects.
    void thisRun.then(() => {
      if (this.queuedRuns.get(meetingId) === thisRun) {
        this.queuedRuns.delete(meetingId);
      }
    });
  }

  private async run(meetingId: string): Promise<void> {
    const recordings =
      await this.recordingsRepository.findByMeetingId(meetingId);

    const readyRecordings = recordings
      .filter(
        (r): r is typeof r & { transcriptText: string } =>
          r.status === RecordingStatus.READY && r.transcriptText !== null,
      )
      .map((r) => ({ id: r.id, transcriptText: r.transcriptText }));

    const allRecordingsTerminal = recordings.every(
      (r) =>
        r.status === RecordingStatus.READY ||
        r.status === RecordingStatus.FAILED,
    );

    await this.meetingSummaryService.generateForMeeting(
      meetingId,
      readyRecordings,
      allRecordingsTerminal,
    );
  }
}
