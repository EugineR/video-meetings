import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import {
  ProfileResponse,
  toProfileResponse,
} from '../../interfaces/profile-response.interface';
import { UsersRepository } from '../../users.repository';
import { UpdateProfileCommand } from '../update-profile.command';

@CommandHandler(UpdateProfileCommand)
export class UpdateProfileHandler implements ICommandHandler<
  UpdateProfileCommand,
  ProfileResponse
> {
  constructor(private readonly usersRepository: UsersRepository) {}

  async execute(command: UpdateProfileCommand): Promise<ProfileResponse> {
    const user = await this.usersRepository.updateName(
      command.userId,
      command.name,
    );
    return toProfileResponse(user);
  }
}
