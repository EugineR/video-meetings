import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { User } from '@prisma/client';
import { UsersRepository } from '../../users.repository';
import { CreateUserCommand } from '../create-user.command';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<
  CreateUserCommand,
  User
> {
  constructor(private readonly usersRepository: UsersRepository) {}

  execute(command: CreateUserCommand): Promise<User> {
    return this.usersRepository.create(
      command.name,
      command.email,
      command.hashedPassword,
    );
  }
}
