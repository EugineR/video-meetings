import { Module } from '@nestjs/common';
import { TaskRepository } from './tasks.repository';
import { TaskService } from './tasks.service';

/**
 * `TaskRepository` stays module-private; other modules depend on `TaskService` directly, the
 * same direct-injection pattern `MeetingSummaryModule` uses for `MeetingSummaryService` — there is
 * no controller here, `Task` data isn't read by anything outside the backend yet.
 */
@Module({
  providers: [TaskRepository, TaskService],
  exports: [TaskService],
})
export class TasksModule {}
