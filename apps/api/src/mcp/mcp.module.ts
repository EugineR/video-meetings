import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { TaskTools } from './task-tools';

@Module({
  imports: [TasksModule],
  controllers: [McpController],
  providers: [McpService, TaskTools],
})
export class McpModule {}
