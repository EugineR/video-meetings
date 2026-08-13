import { UnauthorizedException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { FindUserByEmailQuery } from '../../../users/queries/find-user-by-email.query';
import { AccessTokenResponse } from '../../interfaces/access-token-response.interface';
import { TokenService } from '../../token.service';
import { LoginUserQuery } from '../login-user.query';

@QueryHandler(LoginUserQuery)
export class LoginUserHandler implements IQueryHandler<
  LoginUserQuery,
  AccessTokenResponse
> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly tokenService: TokenService,
  ) {}

  async execute(query: LoginUserQuery): Promise<AccessTokenResponse> {
    const user = await this.queryBus.execute<FindUserByEmailQuery, User | null>(
      new FindUserByEmailQuery(query.email),
    );
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(query.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return { accessToken: this.tokenService.sign(user.id, user.email) };
  }
}
