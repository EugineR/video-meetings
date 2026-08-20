import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { MulterModule } from '@nestjs/platform-express';
import { Request } from 'express';
import { AuthModule } from '../auth/auth.module';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StorageService } from '../storage/storage.service';
import { createUploadMulterOptions } from '../storage/upload-multer-options.factory';
import {
  assertKnownAvatarMimeTypes,
  isAllowedAvatarFile,
  parseAllowedMimeTypes,
} from './avatar-file-filter';
import { ChangePasswordHandler } from './commands/handlers/change-password.handler';
import { CreateUserHandler } from './commands/handlers/create-user.handler';
import { DeleteAvatarHandler } from './commands/handlers/delete-avatar.handler';
import { UpdateProfileHandler } from './commands/handlers/update-profile.handler';
import { UploadAvatarHandler } from './commands/handlers/upload-avatar.handler';
import { UserAvatarsRepository } from './user-avatars.repository';
import { FindUserByEmailHandler } from './queries/handlers/find-user-by-email.handler';
import { GetProfileHandler } from './queries/handlers/get-profile.handler';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

type RequestWithUser = Request & { user?: JwtPayload };

const CommandHandlers = [
  CreateUserHandler,
  UpdateProfileHandler,
  ChangePasswordHandler,
  UploadAvatarHandler,
  DeleteAvatarHandler,
];
const QueryHandlers = [FindUserByEmailHandler, GetProfileHandler];

@Module({
  imports: [
    CqrsModule,
    AuthModule,
    MulterModule.registerAsync({
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService, storage: StorageService) => {
        const allowedMimeTypes = parseAllowedMimeTypes(
          config.getOrThrow<string>('ALLOWED_AVATAR_MIME_TYPES'),
        );
        // Fails fast at bootstrap rather than silently 415-ing every upload of a
        // MIME type an operator added to ALLOWED_AVATAR_MIME_TYPES but that
        // avatar-file-filter.ts's extension map doesn't know about yet.
        assertKnownAvatarMimeTypes(allowedMimeTypes);

        return createUploadMulterOptions({
          storageService: storage,
          resolveDir: (req) => {
            const userId = (req as RequestWithUser).user?.sub;
            if (!userId) {
              throw new Error('Missing authenticated user');
            }
            return storage.resolveAvatarDir(userId);
          },
          maxFileSizeBytes: Number(
            config.getOrThrow<string>('MAX_AVATAR_SIZE_BYTES'),
          ),
          allowedMimeTypes,
          isAllowedFile: isAllowedAvatarFile,
          unsupportedMediaTypeMessage: (mimetype) =>
            `Unsupported avatar file type: ${mimetype}`,
        });
      },
    }),
  ],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    UserAvatarsRepository,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
})
export class UsersModule {}
