import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { ClaudeAgentModule } from '../claude-agent/claude-agent.module';
import { MeetingSummaryRepository } from './meeting-summary.repository';
import { MeetingSummaryService } from './meeting-summary.service';
import { GetMeetingSummaryHandler } from './queries/handlers/get-meeting-summary.handler';

const QueryHandlers = [GetMeetingSummaryHandler];

/**
 * Exports `MeetingSummaryService` for direct injection into `meetings/`'s `UploadRecordingHandler`
 * — the same background-job-trigger pattern `TranscriptionModule`/`TranscriptionService` already
 * establishes. `MeetingSummaryRepository` stays module-private; other modules read summary data by
 * dispatching `GetMeetingSummaryQuery` on the `QueryBus` instead.
 */
@Module({
  imports: [CqrsModule, ClaudeAgentModule],
  providers: [
    MeetingSummaryRepository,
    MeetingSummaryService,
    ...QueryHandlers,
  ],
  exports: [MeetingSummaryService],
})
export class MeetingSummaryModule {}
