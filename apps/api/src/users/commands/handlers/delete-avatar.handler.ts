import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { UserAvatarsRepository } from '../../user-avatars.repository';
import { StorageService } from '../../../storage/storage.service';
import { DeleteAvatarCommand } from '../delete-avatar.command';

@CommandHandler(DeleteAvatarCommand)
export class DeleteAvatarHandler implements ICommandHandler<
  DeleteAvatarCommand,
  void
> {
  constructor(
    private readonly userAvatarsRepository: UserAvatarsRepository,
    private readonly storageService: StorageService,
  ) {}

  async execute(command: DeleteAvatarCommand): Promise<void> {
    const avatar = await this.userAvatarsRepository.delete(command.userId);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    await this.storageService.delete(avatar.storagePath);
  }
}
