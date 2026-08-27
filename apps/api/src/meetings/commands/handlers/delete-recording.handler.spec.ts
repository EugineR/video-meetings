import { NotFoundException } from '@nestjs/common';
import { Meeting, MeetingRecording, RecordingStatus } from '@prisma/client';
import { MeetingsRepository } from '../../meetings.repository';
import { RecordingsRepository } from '../../recordings.repository';
import { SummaryReconciliationService } from '../../summary-reconciliation.service';
import { StorageService } from '../../../storage/storage.service';
import { DeleteRecordingCommand } from '../delete-recording.command';
import { DeleteRecordingHandler } from './delete-recording.handler';

describe('DeleteRecordingHandler', () => {
  const meetingId = 'meeting-1';
  const ownerId = 'owner-1';
  const recordingId = 'recording-1';
  const storagePath = '/uploads/meeting-1/recording.mp4';

  let meeting: Meeting;
  let recording: MeetingRecording;
  let findByIdAndOwner: jest.Mock;
  let deleteRecording: jest.Mock;
  let deleteFile: jest.Mock;
  let reconcile: jest.Mock;
  let handler: DeleteRecordingHandler;

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
      status: RecordingStatus.READY,
      transcriptText: 'the transcript',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    findByIdAndOwner = jest.fn().mockResolvedValue(meeting);
    deleteRecording = jest.fn().mockResolvedValue(recording);
    deleteFile = jest.fn().mockResolvedValue(undefined);
    reconcile = jest.fn();

    const meetingsRepository = {
      findByIdAndOwner,
    } as unknown as MeetingsRepository;
    const recordingsRepository = {
      delete: deleteRecording,
    } as unknown as RecordingsRepository;
    const storageService = {
      delete: deleteFile,
    } as unknown as StorageService;
    const summaryReconciliationService = {
      reconcile,
    } as unknown as SummaryReconciliationService;

    handler = new DeleteRecordingHandler(
      meetingsRepository,
      recordingsRepository,
      storageService,
      summaryReconciliationService,
    );
  });

  it('throws when the meeting is not owned by the caller, without touching the recording or its file', async () => {
    findByIdAndOwner.mockResolvedValue(null);

    await expect(
      handler.execute(
        new DeleteRecordingCommand(meetingId, recordingId, ownerId),
      ),
    ).rejects.toThrow(NotFoundException);

    expect(deleteRecording).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('throws when the recording is already gone, without reconciling the summary', async () => {
    deleteRecording.mockResolvedValue(null);

    await expect(
      handler.execute(
        new DeleteRecordingCommand(meetingId, recordingId, ownerId),
      ),
    ).rejects.toThrow(NotFoundException);

    expect(deleteFile).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('deletes the row and its file, then triggers summary reconciliation for the meeting', async () => {
    await handler.execute(
      new DeleteRecordingCommand(meetingId, recordingId, ownerId),
    );

    expect(deleteRecording).toHaveBeenCalledWith(meetingId, recordingId);
    expect(deleteFile).toHaveBeenCalledWith(storagePath);
    expect(reconcile).toHaveBeenCalledWith(meetingId);
  });

  it('triggers summary reconciliation even when the deleted recording never reached READY', async () => {
    deleteRecording.mockResolvedValue({
      ...recording,
      status: RecordingStatus.PROCESSING,
      transcriptText: null,
    });

    await handler.execute(
      new DeleteRecordingCommand(meetingId, recordingId, ownerId),
    );

    expect(reconcile).toHaveBeenCalledWith(meetingId);
  });
});
