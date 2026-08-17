import { mkdir } from 'node:fs/promises';
import { Module, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { AuthModule } from '../auth/auth.module';
import { StorageService } from '../storage/storage.service';
import { CreateMeetingHandler } from './commands/handlers/create-meeting.handler';
import { DeleteRecordingHandler } from './commands/handlers/delete-recording.handler';
import { UploadRecordingHandler } from './commands/handlers/upload-recording.handler';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';
import { GetMeetingByIdHandler } from './queries/handlers/get-meeting-by-id.handler';
import { GetMeetingsHandler } from './queries/handlers/get-meetings.handler';
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
const QueryHandlers = [GetMeetingsHandler, GetMeetingByIdHandler];

@Module({
  imports: [
    CqrsModule,
    AuthModule,
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

        return {
          storage: diskStorage({
            destination: (req, _file, cb) => {
              const meetingId = (req.params as { id: string }).id;
              let dir: string;
              try {
                dir = storage.resolveMeetingDir(meetingId);
              } catch (err) {
                return cb(err as Error, '');
              }
              void mkdir(dir, { recursive: true })
                .then(() => cb(null, dir))
                .catch((err: unknown) => cb(err as Error, dir));
            },
            filename: (_req, file, cb) => {
              cb(null, storage.generateFilename(file.originalname));
            },
          }),
          limits: {
            fileSize: Number(
              config.getOrThrow<string>('MAX_UPLOAD_SIZE_BYTES'),
            ),
          },
          fileFilter: (_req, file, cb) => {
            if (
              !isAllowedRecordingFile(
                file.mimetype,
                file.originalname,
                allowedMimeTypes,
              )
            ) {
              return cb(
                new UnsupportedMediaTypeException(
                  `Unsupported recording file type: ${file.mimetype}`,
                ),
                false,
              );
            }
            cb(null, true);
          },
        };
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
