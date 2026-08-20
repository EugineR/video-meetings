import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AllowQueryToken } from '../auth/decorators/allow-query-token.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccessTokenResponse } from '../auth/interfaces/access-token-response.interface';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ChangePasswordCommand } from './commands/change-password.command';
import { DeleteAvatarCommand } from './commands/delete-avatar.command';
import { UpdateProfileCommand } from './commands/update-profile.command';
import { UploadAvatarCommand } from './commands/upload-avatar.command';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AvatarContent } from './interfaces/avatar-content.interface';
import { AvatarResponse } from './interfaces/avatar-response.interface';
import { ProfileResponse } from './interfaces/profile-response.interface';
import { GetAvatarQuery } from './queries/get-avatar.query';
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

  @Post('me/avatar')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AvatarResponse> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    return this.commandBus.execute(new UploadAvatarCommand(user.sub, file));
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAvatar(@CurrentUser() user: JwtPayload): Promise<void> {
    return this.commandBus.execute(new DeleteAvatarCommand(user.sub));
  }

  @Get('me/avatar')
  @AllowQueryToken()
  async getAvatar(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const content: AvatarContent = await this.queryBus.execute(
      new GetAvatarQuery(user.sub),
    );

    res.set({
      'Content-Type': content.mimeType,
      'Content-Length': String(content.sizeBytes),
      'Cache-Control': 'no-cache',
    });

    return new StreamableFile(content.stream);
  }
}
