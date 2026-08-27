import { NotFoundException } from '@nestjs/common';
import { Meeting, MeetingRecording, RecordingStatus } from '@prisma/client';
import { MeetingsRepository } from '../../meetings.repository';
import { RecordingsRepository } from '../../recordings.repository';
import { SummaryReconciliationService } from '../../summary-reconciliation.service';
import { StorageService } from '../../../storage/storage.service';
import { TranscriptionService } from '../../../transcription/transcription.service';
import { UploadRecordingCommand } from '../upload-recording.command';
import { UploadRecordingHandler } from './upload-recording.handler';

/** Lets a pending fire-and-forget chain (any number of `await` hops) settle before assertions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('UploadRecordingHandler', () => {
  const meetingId = 'meeting-1';
  const ownerId = 'owner-1';
  const storagePath = '/uploads/meeting-1/recording.mp4';
  const recordingId = 'recording-1';

  let meeting: Meeting;
  let recording: MeetingRecording;
  let findByIdAndOwner: jest.Mock;
  let create: jest.Mock;
  let findByMeetingId: jest.Mock;
  let updateStatusIfCurrent: jest.Mock;
  let deleteFile: jest.Mock;
  let pruneMeetingDir: jest.Mock;
  let transcribe: jest.Mock;
  let reconcile: jest.Mock;
  let handler: UploadRecordingHandler;

  const file = {
    path: storagePath,
    originalname: 'recording.mp4',
    mimetype: 'video/mp4',
    size: 1024,
  } as Express.Multer.File;

  beforeEach(() => {
    meeting = {
      id: meetingId,
      title: 'Standup',
      date: new Date(),
      participants: [],
      ownerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    recording = {
      id: recordingId,
      meetingId,
      originalFilename: 'recording.mp4',
      storagePath,
      mimeType: 'video/mp4',
      sizeBytes: BigInt(1024),
      status: RecordingStatus.UPLOADED,
      transcriptText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    findByIdAndOwner = jest.fn().mockResolvedValue(meeting);
    create = jest.fn().mockResolvedValue(recording);
    findByMeetingId = jest.fn().mockResolvedValue([recording]);
    updateStatusIfCurrent = jest.fn().mockResolvedValue(true);
    deleteFile = jest.fn().mockResolvedValue(undefined);
    pruneMeetingDir = jest.fn().mockResolvedValue(undefined);
    transcribe = jest.fn().mockResolvedValue('the transcript');
    reconcile = jest.fn();

    const meetingsRepository = {
      findByIdAndOwner,
    } as unknown as MeetingsRepository;
    const recordingsRepository = {
      create,
      findByMeetingId,
      updateStatusIfCurrent,
    } as unknown as RecordingsRepository;
    const storageService = {
      delete: deleteFile,
      pruneMeetingDir,
    } as unknown as StorageService;
    const transcriptionService = {
      transcribe,
    } as unknown as TranscriptionService;
    const summaryReconciliationService = {
      reconcile,
    } as unknown as SummaryReconciliationService;

    handler = new UploadRecordingHandler(
      meetingsRepository,
      recordingsRepository,
      storageService,
      transcriptionService,
      summaryReconciliationService,
    );
  });

  it('deletes the uploaded file and throws when the meeting is not owned by the caller', async () => {
    findByIdAndOwner.mockResolvedValue(null);

    await expect(
      handler.execute(new UploadRecordingCommand(meetingId, ownerId, file)),
    ).rejects.toThrow(NotFoundException);

    expect(deleteFile).toHaveBeenCalledWith(storagePath);
    expect(create).not.toHaveBeenCalled();
  });

  it('persists the recording as UPLOADED and responds without waiting for transcription', async () => {
    transcribe.mockImplementation(() => new Promise(() => {}));

    const result = await handler.execute(
      new UploadRecordingCommand(meetingId, ownerId, file),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ status: RecordingStatus.UPLOADED }),
    );
    expect(result.status).toBe(RecordingStatus.UPLOADED);
    expect(pruneMeetingDir).toHaveBeenCalledWith(meetingId, [storagePath]);
  });

  it('prunes against the full current set of the meeting recordings, not just the one just uploaded', async () => {
    const otherStoragePath = '/uploads/meeting-1/other-recording.mp3';
    findByMeetingId.mockResolvedValue([
      recording,
      { ...recording, id: 'recording-2', storagePath: otherStoragePath },
    ]);
    transcribe.mockImplementation(() => new Promise(() => {}));

    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));

    expect(findByMeetingId).toHaveBeenCalledWith(meetingId);
    expect(pruneMeetingDir).toHaveBeenCalledWith(meetingId, [
      storagePath,
      otherStoragePath,
    ]);
  });

  it('drives status UPLOADED -> PROCESSING -> READY with the transcript on success', async () => {
    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(updateStatusIfCurrent).toHaveBeenNthCalledWith(1, recordingId, {
      status: RecordingStatus.PROCESSING,
    });
    expect(transcribe).toHaveBeenCalledWith(storagePath);
    expect(updateStatusIfCurrent).toHaveBeenNthCalledWith(2, recordingId, {
      status: RecordingStatus.READY,
      transcriptText: 'the transcript',
    });
  });

  it('triggers summary reconciliation for the meeting once transcription reaches READY', async () => {
    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(reconcile).toHaveBeenCalledWith(meetingId);
  });

  it('triggers summary reconciliation for the meeting when transcription fails too', async () => {
    transcribe.mockRejectedValue(new Error('whisper-cli crashed'));

    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(reconcile).toHaveBeenCalledWith(meetingId);
  });

  it('does not trigger summary reconciliation before transcription has settled', async () => {
    transcribe.mockImplementation(() => new Promise(() => {}));

    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(reconcile).not.toHaveBeenCalled();
  });

  it('drives status UPLOADED -> PROCESSING -> FAILED when transcription throws', async () => {
    transcribe.mockRejectedValue(new Error('whisper-cli crashed'));

    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(updateStatusIfCurrent).toHaveBeenNthCalledWith(1, recordingId, {
      status: RecordingStatus.PROCESSING,
    });
    expect(updateStatusIfCurrent).toHaveBeenNthCalledWith(2, recordingId, {
      status: RecordingStatus.FAILED,
    });
  });

  it('never starts transcription once the recording has already moved on when PROCESSING would be persisted', async () => {
    updateStatusIfCurrent.mockResolvedValueOnce(false);

    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(updateStatusIfCurrent).toHaveBeenCalledTimes(1);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('does not persist READY once the recording has since been deleted', async () => {
    updateStatusIfCurrent
      .mockResolvedValueOnce(true) // PROCESSING succeeds
      .mockResolvedValueOnce(false); // READY write finds the recording already gone

    await handler.execute(new UploadRecordingCommand(meetingId, ownerId, file));
    await flushMicrotasks();

    expect(updateStatusIfCurrent).toHaveBeenCalledTimes(2);
    expect(updateStatusIfCurrent).toHaveBeenNthCalledWith(2, recordingId, {
      status: RecordingStatus.READY,
      transcriptText: 'the transcript',
    });
  });
});
