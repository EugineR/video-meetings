import { ConflictException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { UsersRepository } from '../../../users/users.repository';
import { AccessTokenResponse } from '../../interfaces/access-token-response.interface';
import { TokenService } from '../../token.service';
import { RegisterUserCommand } from '../register-user.command';

const PASSWORD_SALT_ROUNDS = 10;

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<
  RegisterUserCommand,
  AccessTokenResponse
> {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(command: RegisterUserCommand): Promise<AccessTokenResponse> {
    const existingUser = await this.usersRepository.findByEmail(command.email);
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const hashedPassword = await bcrypt.hash(
      command.password,
      PASSWORD_SALT_ROUNDS,
    );
    const user = await this.usersRepository.create(
      command.email,
      hashedPassword,
    );

    return { accessToken: this.tokenService.sign(user.id, user.email) };
  }
}
