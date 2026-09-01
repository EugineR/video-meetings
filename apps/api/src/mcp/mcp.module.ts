import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskTools } from '../tasks/task-tools';
import { TasksModule } from '../tasks/tasks.module';
import { McpAuthGuard } from './guards/mcp-auth.guard';
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
 *
 * Also imports `AuthModule` purely for its exported `JwtModule`/`JwtService` binding — `McpAuthGuard`
 * (`./guards/mcp-auth.guard.ts`) reuses the same JWT validation as the rest of the API rather than a
 * separate identity provider.
 */
@Module({
  imports: [TasksModule, AuthModule],
  controllers: [McpController],
  providers: [
    McpService,
    McpAuthGuard,
    {
      provide: MCP_TOOL_REGISTRARS,
      useFactory: (taskTools: TaskTools): McpToolRegistrar[] => [taskTools],
      inject: [TaskTools],
    },
  ],
})
export class McpModule {}
