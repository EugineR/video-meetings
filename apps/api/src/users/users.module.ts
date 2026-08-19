import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { ChangePasswordHandler } from './commands/handlers/change-password.handler';
import { CreateUserHandler } from './commands/handlers/create-user.handler';
import { UpdateProfileHandler } from './commands/handlers/update-profile.handler';
import { FindUserByEmailHandler } from './queries/handlers/find-user-by-email.handler';
import { GetProfileHandler } from './queries/handlers/get-profile.handler';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

const CommandHandlers = [
  CreateUserHandler,
  UpdateProfileHandler,
  ChangePasswordHandler,
];
const QueryHandlers = [FindUserByEmailHandler, GetProfileHandler];

@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersRepository, ...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
