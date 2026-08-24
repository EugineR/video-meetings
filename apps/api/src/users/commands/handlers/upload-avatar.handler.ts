import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  AvatarResponse,
  toAvatarResponse,
} from '../../interfaces/avatar-response.interface';
import { UserAvatarsRepository } from '../../user-avatars.repository';
import { StorageService } from '../../../storage/storage.service';
import { UploadAvatarCommand } from '../upload-avatar.command';

@CommandHandler(UploadAvatarCommand)
export class UploadAvatarHandler implements ICommandHandler<
  UploadAvatarCommand,
  AvatarResponse
> {
  constructor(
    private readonly userAvatarsRepository: UserAvatarsRepository,
    private readonly storageService: StorageService,
  ) {}

  async execute(command: UploadAvatarCommand): Promise<AvatarResponse> {
    const avatar = await this.userAvatarsRepository.createOrReplace({
      userId: command.userId,
      originalFilename: command.file.originalname,
      storagePath: command.file.path,
      mimeType: command.file.mimetype,
      sizeBytes: BigInt(command.file.size),
    });

    // Based on the actual directory contents after the DB upsert commits
    // (not a pre-upsert snapshot), so a losing concurrent upload's file is
    // still cleaned up even though this handler never read its metadata —
    // mirrors UploadRecordingHandler's use of pruneMeetingDir.
    await this.storageService.pruneAvatarDir(
      command.userId,
      avatar.storagePath,
    );

    return toAvatarResponse(avatar);
  }
}
