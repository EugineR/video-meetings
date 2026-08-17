import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { FileInterceptor } from '@nestjs/platform-express';
import { Meeting } from '@prisma/client';
import type { Response } from 'express';
import { AllowQueryToken } from '../auth/decorators/allow-query-token.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateMeetingCommand } from './commands/create-meeting.command';
import { DeleteRecordingCommand } from './commands/delete-recording.command';
import { UploadRecordingCommand } from './commands/upload-recording.command';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingDetailResponse } from './interfaces/meeting-detail-response.interface';
import { MeetingListItemResponse } from './interfaces/meeting-list-item-response.interface';
import { RecordingContent } from './interfaces/recording-content.interface';
import { RecordingResponse } from './interfaces/recording-response.interface';
import { GetMeetingByIdQuery } from './queries/get-meeting-by-id.query';
import { GetMeetingsQuery } from './queries/get-meetings.query';
import { GetRecordingQuery } from './queries/get-recording.query';

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
  findAll(@CurrentUser() user: JwtPayload): Promise<MeetingListItemResponse[]> {
    return this.queryBus.execute(new GetMeetingsQuery(user.sub));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<MeetingDetailResponse> {
    return this.queryBus.execute(new GetMeetingByIdQuery(id, user.sub));
  }

  @Get(':id/recording/content')
  @AllowQueryToken()
  async getRecordingContent(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const content: RecordingContent = await this.queryBus.execute(
      new GetRecordingQuery(id, user.sub, range),
    );

    res.set({
      'Content-Type': content.mimeType,
      'Accept-Ranges': 'bytes',
    });

    if (content.range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.set({
        'Content-Range': `bytes ${content.range.start}-${content.range.end}/${content.totalSize}`,
        'Content-Length': String(content.range.end - content.range.start + 1),
      });
    } else {
      res.set({ 'Content-Length': String(content.totalSize) });
    }

    return new StreamableFile(content.stream);
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
