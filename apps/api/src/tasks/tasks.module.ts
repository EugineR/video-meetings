import { Module } from '@nestjs/common';
import { TaskTools } from './task-tools';
import { TaskRepository } from './tasks.repository';
import { TaskService } from './tasks.service';

/**
 * `TaskRepository` stays module-private; other modules depend on `TaskService` directly, the
 * same direct-injection pattern `MeetingSummaryModule` uses for `MeetingSummaryService` — there is
 * no controller here, `Task` data isn't read by anything outside the backend yet. `TaskTools` (the
 * `tasks` domain's `McpToolRegistrar`, `../mcp/mcp-tool-registrar.ts`) is exported the same way, so
 * `McpModule` can import this module and fold it into the `MCP_TOOL_REGISTRARS` token without this
 * module knowing MCP exists.
 */
@Module({
  providers: [TaskRepository, TaskService, TaskTools],
  exports: [TaskService, TaskTools],
})
export class TasksModule {}
