import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nodewhisper } from 'nodejs-whisper';
import { TranscriptionService } from './transcription.service';
import { WHISPER_RUNNER, WhisperRunner } from './whisper-runner';

/** The only Whisper model size this feature supports — see the PRD's "In scope" / "Out of scope". */
const WHISPER_MODEL_NAME = 'base';

@Module({
  providers: [
    TranscriptionService,
    {
      provide: WHISPER_RUNNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): WhisperRunner => {
        const modelRootPath = config.get<string>('WHISPER_MODEL_DIR');

        return (filePath: string) =>
          nodewhisper(filePath, {
            modelName: WHISPER_MODEL_NAME,
            autoDownloadModelName: WHISPER_MODEL_NAME,
            ...(modelRootPath ? { modelRootPath } : {}),
            removeWavFileAfterTranscription: true,
            whisperOptions: {
              splitOnWord: true,
            },
          });
      },
    },
  ],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
