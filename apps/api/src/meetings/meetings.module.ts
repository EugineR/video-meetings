import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { MulterModule } from '@nestjs/platform-express';
import { AuthModule } from '../auth/auth.module';
import { StorageService } from '../storage/storage.service';
import { createUploadMulterOptions } from '../storage/upload-multer-options.factory';
import { TranscriptionModule } from '../transcription/transcription.module';
import { CreateMeetingHandler } from './commands/handlers/create-meeting.handler';
import { DeleteRecordingHandler } from './commands/handlers/delete-recording.handler';
import { UploadRecordingHandler } from './commands/handlers/upload-recording.handler';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';
import { GetMeetingByIdHandler } from './queries/handlers/get-meeting-by-id.handler';
import { GetMeetingsHandler } from './queries/handlers/get-meetings.handler';
import { GetRecordingHandler } from './queries/handlers/get-recording.handler';
import {
  assertKnownRecordingMimeTypes,
  isAllowedRecordingFile,
  parseAllowedMimeTypes,
} from './recording-file-filter';
import { RecordingsRepository } from './recordings.repository';

const CommandHandlers = [
  CreateMeetingHandler,
  UploadRecordingHandler,
  DeleteRecordingHandler,
];
const QueryHandlers = [
  GetMeetingsHandler,
  GetMeetingByIdHandler,
  GetRecordingHandler,
];

@Module({
  imports: [
    CqrsModule,
    AuthModule,
    TranscriptionModule,
    MulterModule.registerAsync({
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService, storage: StorageService) => {
        const allowedMimeTypes = parseAllowedMimeTypes(
          config.getOrThrow<string>('ALLOWED_RECORDING_MIME_TYPES'),
        );
        // Fails fast at bootstrap rather than silently 415-ing every upload of a
        // MIME type an operator added to ALLOWED_RECORDING_MIME_TYPES but that
        // recording-file-filter.ts's extension map doesn't know about yet.
        assertKnownRecordingMimeTypes(allowedMimeTypes);

        return createUploadMulterOptions({
          storageService: storage,
          resolveDir: (req) =>
            storage.resolveMeetingDir((req.params as { id: string }).id),
          maxFileSizeBytes: Number(
            config.getOrThrow<string>('MAX_UPLOAD_SIZE_BYTES'),
          ),
          allowedMimeTypes,
          isAllowedFile: isAllowedRecordingFile,
          unsupportedMediaTypeMessage: (mimetype) =>
            `Unsupported recording file type: ${mimetype}`,
        });
      },
    }),
  ],
  controllers: [MeetingsController],
  providers: [
    MeetingsRepository,
    RecordingsRepository,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
})
export class MeetingsModule {}
