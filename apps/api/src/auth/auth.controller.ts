import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { RegisterUserCommand } from './commands/register-user.command';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AccessTokenResponse } from './interfaces/access-token-response.interface';
import { LoginUserQuery } from './queries/login-user.query';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<AccessTokenResponse> {
    return this.commandBus.execute(
      new RegisterUserCommand(dto.name, dto.email, dto.password),
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AccessTokenResponse> {
    return this.queryBus.execute(new LoginUserQuery(dto.email, dto.password));
  }
}
