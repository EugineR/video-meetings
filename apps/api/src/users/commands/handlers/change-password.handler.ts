import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { AccessTokenResponse } from '../../../auth/interfaces/access-token-response.interface';
import {
  isDifferentFromCurrent,
  PASSWORD_SALT_ROUNDS,
} from '../../../auth/password-rules';
import { TokenService } from '../../../auth/token.service';
import { UsersRepository } from '../../users.repository';
import { ChangePasswordCommand } from '../change-password.command';

@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<
  ChangePasswordCommand,
  AccessTokenResponse
> {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(command: ChangePasswordCommand): Promise<AccessTokenResponse> {
    const user = await this.usersRepository.findById(command.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      command.currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (!isDifferentFromCurrent(command.newPassword, command.currentPassword)) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const hashedPassword = await bcrypt.hash(
      command.newPassword,
      PASSWORD_SALT_ROUNDS,
    );
    const updatedUser = await this.usersRepository.updatePassword(
      command.userId,
      hashedPassword,
    );
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return {
      accessToken: this.tokenService.sign(updatedUser.id, updatedUser.email),
    };
  }
}
