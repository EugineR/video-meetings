import { MeetingRecording, RecordingStatus } from '@prisma/client';
import { MeetingSummaryService } from '../meeting-summary/meeting-summary.service';
import { MeetingsRepository } from './meetings.repository';
import { RecordingsRepository } from './recordings.repository';
import { SummaryReconciliationService } from './summary-reconciliation.service';

/** Lets a pending fire-and-forget chain (any number of `await` hops) settle before assertions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function recording(overrides: Partial<MeetingRecording>): MeetingRecording {
  return {
    id: 'recording-1',
    meetingId: 'meeting-1',
    originalFilename: 'recording.mp4',
    storagePath: '/uploads/meeting-1/recording.mp4',
    mimeType: 'video/mp4',
    sizeBytes: BigInt(1024),
    status: RecordingStatus.UPLOADED,
    transcriptText: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SummaryReconciliationService', () => {
  const meetingId = 'meeting-1';
  const ownerId = 'owner-1';
  let findById: jest.Mock;
  let findByMeetingId: jest.Mock;
  let generateForMeeting: jest.Mock;
  let service: SummaryReconciliationService;

  beforeEach(() => {
    findById = jest.fn().mockResolvedValue({ ownerId });
    findByMeetingId = jest.fn().mockResolvedValue([]);
    generateForMeeting = jest.fn().mockResolvedValue(undefined);

    const meetingsRepository = {
      findById,
    } as unknown as MeetingsRepository;
    const recordingsRepository = {
      findByMeetingId,
    } as unknown as RecordingsRepository;
    const meetingSummaryService = {
      generateForMeeting,
    } as unknown as MeetingSummaryService;

    service = new SummaryReconciliationService(
      meetingsRepository,
      recordingsRepository,
      meetingSummaryService,
    );
  });

  it('reconciles over every READY transcript when every recording is terminal', async () => {
    findByMeetingId.mockResolvedValue([
      recording({
        status: RecordingStatus.READY,
        transcriptText: 'the transcript',
      }),
    ]);

    service.reconcile(meetingId);
    await flushMicrotasks();

    expect(generateForMeeting).toHaveBeenCalledWith(
      meetingId,
      ownerId,
      [{ id: 'recording-1', transcriptText: 'the transcript' }],
      true,
    );
  });

  it('marks the run not-yet-final when another recording is still in progress', async () => {
    findByMeetingId.mockResolvedValue([
      recording({
        status: RecordingStatus.READY,
        transcriptText: 'the transcript',
      }),
      recording({ id: 'recording-2', status: RecordingStatus.PROCESSING }),
    ]);

    service.reconcile(meetingId);
    await flushMicrotasks();

    expect(generateForMeeting).toHaveBeenCalledWith(
      meetingId,
      ownerId,
      [{ id: 'recording-1', transcriptText: 'the transcript' }],
      false,
    );
  });

  it('reconciles with an empty transcript list when the only recording failed transcription', async () => {
    findByMeetingId.mockResolvedValue([
      recording({ status: RecordingStatus.FAILED }),
    ]);

    service.reconcile(meetingId);
    await flushMicrotasks();

    expect(generateForMeeting).toHaveBeenCalledWith(
      meetingId,
      ownerId,
      [],
      true,
    );
  });

  it('excludes FAILED recordings but still finalizes once an earlier one already succeeded', async () => {
    findByMeetingId.mockResolvedValue([
      recording({
        id: 'recording-2',
        status: RecordingStatus.READY,
        transcriptText: 'earlier transcript',
      }),
      recording({ status: RecordingStatus.FAILED }),
    ]);

    service.reconcile(meetingId);
    await flushMicrotasks();

    expect(generateForMeeting).toHaveBeenCalledWith(
      meetingId,
      ownerId,
      [{ id: 'recording-2', transcriptText: 'earlier transcript' }],
      true,
    );
  });

  it('does not let a reconciliation rejection escape as an unhandled rejection', async () => {
    findByMeetingId.mockResolvedValue([
      recording({
        status: RecordingStatus.READY,
        transcriptText: 'the transcript',
      }),
    ]);
    generateForMeeting.mockRejectedValue(new Error('claude agent crashed'));

    service.reconcile(meetingId);
    await flushMicrotasks();

    expect(generateForMeeting).toHaveBeenCalledWith(
      meetingId,
      ownerId,
      [{ id: 'recording-1', transcriptText: 'the transcript' }],
      true,
    );
  });

  it('runs two reconciliations for the same meeting one after another, not concurrently', async () => {
    // The first call snapshots only recording-1 as READY; by the time it actually runs (after
    // the second call has already been queued), recording-2 has also gone READY. Reconciliation
    // re-derives the recording list itself on each run, so both queued runs see the latest state
    // at the time they execute, and — because they're chained rather than concurrent — the second
    // run's write can never be clobbered by the first run finishing after it.
    findByMeetingId.mockResolvedValue([
      recording({
        status: RecordingStatus.READY,
        transcriptText: 'first transcript',
      }),
    ]);
    let resolveFirstGenerate!: () => void;
    generateForMeeting.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstGenerate = resolve;
        }),
    );
    generateForMeeting.mockResolvedValueOnce(undefined);

    service.reconcile(meetingId);
    await flushMicrotasks();
    expect(generateForMeeting).toHaveBeenCalledTimes(1);

    findByMeetingId.mockResolvedValue([
      recording({
        status: RecordingStatus.READY,
        transcriptText: 'first transcript',
      }),
      recording({
        id: 'recording-2',
        status: RecordingStatus.READY,
        transcriptText: 'second transcript',
      }),
    ]);
    service.reconcile(meetingId);
    await flushMicrotasks();
    // The second run is queued but must not have started yet — the first is still in flight.
    expect(generateForMeeting).toHaveBeenCalledTimes(1);

    resolveFirstGenerate();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(generateForMeeting).toHaveBeenCalledTimes(2);
    expect(generateForMeeting).toHaveBeenNthCalledWith(
      2,
      meetingId,
      ownerId,
      [
        { id: 'recording-1', transcriptText: 'first transcript' },
        { id: 'recording-2', transcriptText: 'second transcript' },
      ],
      true,
    );
  });

  it('skips reconciliation entirely when the meeting no longer exists', async () => {
    findById.mockResolvedValue(null);
    findByMeetingId.mockResolvedValue([
      recording({
        status: RecordingStatus.READY,
        transcriptText: 'the transcript',
      }),
    ]);

    service.reconcile(meetingId);
    await flushMicrotasks();

    expect(generateForMeeting).not.toHaveBeenCalled();
  });
});
