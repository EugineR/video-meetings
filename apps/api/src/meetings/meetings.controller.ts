import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { Meeting } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateMeetingCommand } from './commands/create-meeting.command';
import { DeleteRecordingCommand } from './commands/delete-recording.command';
import { UploadRecordingCommand } from './commands/upload-recording.command';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { RecordingResponse } from './interfaces/recording-response.interface';
import { GetMeetingByIdQuery } from './queries/get-meeting-by-id.query';
import { GetMeetingsQuery } from './queries/get-meetings.query';

@UseGuards(JwtAuthGuard)
@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMeetingDto,
  ): Promise<Meeting> {
    return this.commandBus.execute(
      new CreateMeetingCommand(user.sub, dto.title, dto.date, dto.participants),
    );
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload): Promise<Meeting[]> {
    return this.queryBus.execute(new GetMeetingsQuery(user.sub));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Meeting> {
    return this.queryBus.execute(new GetMeetingByIdQuery(id, user.sub));
  }

  @Post(':id/recording')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  uploadRecording(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<RecordingResponse> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    return this.commandBus.execute(
      new UploadRecordingCommand(id, user.sub, file),
    );
  }

  @Delete(':id/recording')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRecording(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.commandBus.execute(new DeleteRecordingCommand(id, user.sub));
  }
}
