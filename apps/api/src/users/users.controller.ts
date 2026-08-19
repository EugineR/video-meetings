import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessTokenResponse } from '../auth/interfaces/access-token-response.interface';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ChangePasswordCommand } from './commands/change-password.command';
import { UpdateProfileCommand } from './commands/update-profile.command';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileResponse } from './interfaces/profile-response.interface';
import { GetProfileQuery } from './queries/get-profile.query';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload): Promise<ProfileResponse> {
    return this.queryBus.execute(new GetProfileQuery(user.sub));
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    if (dto.name === undefined) {
      return this.queryBus.execute(new GetProfileQuery(user.sub));
    }

    return this.commandBus.execute(
      new UpdateProfileCommand(user.sub, dto.name),
    );
  }

  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<AccessTokenResponse> {
    return this.commandBus.execute(
      new ChangePasswordCommand(user.sub, dto.currentPassword, dto.newPassword),
    );
  }
}
