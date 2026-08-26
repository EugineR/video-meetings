import { TranscriptionService } from './transcription.service';
import { WhisperRunner } from './whisper-runner';

describe('TranscriptionService', () => {
  it('parses the transcript text out of the raw output of the injected WhisperRunner', async () => {
    const runWhisper = jest
      .fn<ReturnType<WhisperRunner>, [string]>()
      .mockResolvedValue(
        '[00:00:00.000 --> 00:00:01.500]   Hello, this is a test.',
      );
    const service = new TranscriptionService(runWhisper);

    const result = await service.transcribe('/tmp/recording.mp4');

    expect(runWhisper).toHaveBeenCalledWith('/tmp/recording.mp4');
    expect(result).toBe('Hello, this is a test.');
  });

  it('propagates a rejection from the injected WhisperRunner', async () => {
    const runWhisper = jest
      .fn<ReturnType<WhisperRunner>, [string]>()
      .mockRejectedValue(new Error('whisper-cli exited with code 1'));
    const service = new TranscriptionService(runWhisper);

    await expect(service.transcribe('/tmp/recording.mp4')).rejects.toThrow(
      'whisper-cli exited with code 1',
    );
  });
});
