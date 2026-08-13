import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Meeting } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateMeetingCommand } from './commands/create-meeting.command';
import { CreateMeetingDto } from './dto/create-meeting.dto';
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
}
