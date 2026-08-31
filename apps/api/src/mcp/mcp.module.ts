import { Module } from '@nestjs/common';
import { TaskTools } from '../tasks/task-tools';
import { TasksModule } from '../tasks/tasks.module';
import { McpController } from './mcp.controller';
import { MCP_TOOL_REGISTRARS, McpToolRegistrar } from './mcp-tool-registrar';
import { McpService } from './mcp.service';

/**
 * Imports every domain module whose `McpToolRegistrar` this app registers (currently just
 * `TasksModule`, for `TaskTools`) — Nest instantiates an imported module's providers before this
 * module's own, so each domain's registrar is guaranteed ready before `McpService.onModuleInit`
 * (see `mcp.service.ts`) runs. Adding a new domain means: export its registrar class from its own
 * module, import that module here, and add it to this factory's `inject`/array — `McpService`
 * itself never changes.
 */
@Module({
  imports: [TasksModule],
  controllers: [McpController],
  providers: [
    McpService,
    {
      provide: MCP_TOOL_REGISTRARS,
      useFactory: (taskTools: TaskTools): McpToolRegistrar[] => [taskTools],
      inject: [TaskTools],
    },
  ],
})
export class McpModule {}
