import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { CreateMeetingHandler } from './commands/handlers/create-meeting.handler';
import { MeetingsController } from './meetings.controller';
import { MeetingsRepository } from './meetings.repository';
import { GetMeetingByIdHandler } from './queries/handlers/get-meeting-by-id.handler';
import { GetMeetingsHandler } from './queries/handlers/get-meetings.handler';

const CommandHandlers = [CreateMeetingHandler];
const QueryHandlers = [GetMeetingsHandler, GetMeetingByIdHandler];

@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [MeetingsController],
  providers: [MeetingsRepository, ...CommandHandlers, ...QueryHandlers],
})
export class MeetingsModule {}
