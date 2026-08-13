import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { User } from '@prisma/client';
import { UsersRepository } from '../../users.repository';
import { FindUserByEmailQuery } from '../find-user-by-email.query';

@QueryHandler(FindUserByEmailQuery)
export class FindUserByEmailHandler implements IQueryHandler<
  FindUserByEmailQuery,
  User | null
> {
  constructor(private readonly usersRepository: UsersRepository) {}

  execute(query: FindUserByEmailQuery): Promise<User | null> {
    return this.usersRepository.findByEmail(query.email);
  }
}
