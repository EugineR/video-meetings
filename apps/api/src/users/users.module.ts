import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CreateUserHandler } from './commands/handlers/create-user.handler';
import { UpdateProfileHandler } from './commands/handlers/update-profile.handler';
import { FindUserByEmailHandler } from './queries/handlers/find-user-by-email.handler';
import { GetProfileHandler } from './queries/handlers/get-profile.handler';
import { UsersRepository } from './users.repository';

const CommandHandlers = [CreateUserHandler, UpdateProfileHandler];
const QueryHandlers = [FindUserByEmailHandler, GetProfileHandler];

@Module({
  imports: [CqrsModule],
  providers: [UsersRepository, ...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
