import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { StorageService } from '../../../storage/storage.service';
import { AvatarContent } from '../../interfaces/avatar-content.interface';
import { UserAvatarsRepository } from '../../user-avatars.repository';
import { GetAvatarQuery } from '../get-avatar.query';

@QueryHandler(GetAvatarQuery)
export class GetAvatarHandler implements IQueryHandler<
  GetAvatarQuery,
  AvatarContent
> {
  constructor(
    private readonly userAvatarsRepository: UserAvatarsRepository,
    private readonly storageService: StorageService,
  ) {}

  async execute(query: GetAvatarQuery): Promise<AvatarContent> {
    const avatar = await this.userAvatarsRepository.findByUserId(query.userId);
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return {
      stream: this.storageService.createReadStream(avatar.storagePath),
      mimeType: avatar.mimeType,
      sizeBytes: Number(avatar.sizeBytes),
    };
  }
}
