import { ConflictException } from '@nestjs/common';
import {
  CommandBus,
  CommandHandler,
  ICommandHandler,
  QueryBus,
} from '@nestjs/cqrs';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { CreateUserCommand } from '../../../users/commands/create-user.command';
import { FindUserByEmailQuery } from '../../../users/queries/find-user-by-email.query';
import { AccessTokenResponse } from '../../interfaces/access-token-response.interface';
import { PASSWORD_SALT_ROUNDS } from '../../password-rules';
import { TokenService } from '../../token.service';
import { RegisterUserCommand } from '../register-user.command';

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<
  RegisterUserCommand,
  AccessTokenResponse
> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly tokenService: TokenService,
  ) {}

  async execute(command: RegisterUserCommand): Promise<AccessTokenResponse> {
    const existingUser = await this.queryBus.execute<
      FindUserByEmailQuery,
      User | null
    >(new FindUserByEmailQuery(command.email));
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const hashedPassword = await bcrypt.hash(
      command.password,
      PASSWORD_SALT_ROUNDS,
    );
    const user = await this.commandBus.execute<CreateUserCommand, User>(
      new CreateUserCommand(command.name, command.email, hashedPassword),
    );

    return { accessToken: this.tokenService.sign(user.id, user.email) };
  }
}
