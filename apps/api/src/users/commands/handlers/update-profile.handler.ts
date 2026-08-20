import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  ProfileResponse,
  toProfileResponse,
} from '../../interfaces/profile-response.interface';
import { UserAvatarsRepository } from '../../user-avatars.repository';
import { UsersRepository } from '../../users.repository';
import { UpdateProfileCommand } from '../update-profile.command';

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<
  UpdateProfileCommand,
  ProfileResponse
> {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly userAvatarsRepository: UserAvatarsRepository,
  ) {}

  async execute(command: UpdateProfileCommand): Promise<ProfileResponse> {
    const user = await this.usersRepository.updateName(
      command.userId,
      command.name,
    );
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatar = await this.userAvatarsRepository.findByUserId(
      command.userId,
    );

    return toProfileResponse(user, avatar);
  }
}
