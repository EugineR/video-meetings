import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { TaskService } from '../tasks/tasks.service';

const SERVER_NAME = 'find-tasks';
const SERVER_VERSION = '1.0.0';

/**
 * DI context for this standalone process, scoped to exactly what `find_tasks` needs
 * (`TaskService`, and `PrismaModule`/`ConfigModule` underneath it) rather than the full
 * `AppModule` — this process has no HTTP surface and never touches transcription or the
 * Claude Agent SDK.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TasksModule,
  ],
})
class FindTasksContextModule {}

/**
 * Registers the `find_tasks` tool against the real `TaskService.search` (the same
 * pg_trgm-backed lookup `meeting-tools.ts`'s `find_tasks` SDK tool calls) so this standalone
 * server has no lookup logic of its own to drift out of sync with it.
 */
function registerFindTasks(server: McpServer, taskService: TaskService) {
  server.registerTool(
    'find_tasks',
    {
      description:
        "Finds existing tasks whose title is textually similar to the given query, most similar match first. Use this before creating a task to check whether it already exists. Doesn't change any data.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe('Free text to match task titles against'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const matches = await taskService.search(query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(matches) }],
      };
    },
  );
}

/**
 * Entry point for the standalone `find_tasks` MCP server: an MCP client spawns this file as a
 * subprocess and talks to it over stdio (`StdioServerTransport`), so `logger: false` here keeps
 * Nest's own bootstrap logging off stdout — that stream carries nothing but the MCP protocol
 * once `server.connect` attaches the transport.
 */
async function main() {
  const context = await NestFactory.createApplicationContext(
    FindTasksContextModule,
    { logger: false },
  );

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerFindTasks(server, context.get(TaskService));

  await server.connect(new StdioServerTransport());

  const shutdown = () => {
    context
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start the find_tasks MCP server', error);
  process.exit(1);
});
