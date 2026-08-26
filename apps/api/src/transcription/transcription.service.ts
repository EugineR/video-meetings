import { Inject, Injectable } from '@nestjs/common';
import { extractTranscriptText } from './transcript-text';
import { WHISPER_RUNNER } from './whisper-runner';
import type { WhisperRunner } from './whisper-runner';

/**
 * HTTP-agnostic wrapper around local Whisper inference, following the same shape as
 * `StorageService`: no Express types, no route, no `Response`. The actual whisper.cpp
 * invocation lives behind the injected `WhisperRunner` so it can be stubbed in tests.
 */
@Injectable()
export class TranscriptionService {
  constructor(
    @Inject(WHISPER_RUNNER) private readonly runWhisper: WhisperRunner,
  ) {}

  async transcribe(filePath: string): Promise<string> {
    const rawOutput = await this.runWhisper(filePath);
    return extractTranscriptText(rawOutput);
  }
}
