import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { RegisterUserHandler } from './commands/handlers/register-user.handler';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginUserHandler } from './queries/handlers/login-user.handler';
import { TokenService } from './token.service';

const CommandHandlers = [RegisterUserHandler];
const QueryHandlers = [LoginUserHandler];

@Module({
  imports: [
    CqrsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [TokenService, JwtAuthGuard, ...CommandHandlers, ...QueryHandlers],
  exports: [JwtModule, JwtAuthGuard, TokenService],
})
export class AuthModule {}
