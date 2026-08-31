import { Injectable, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const SERVER_NAME = 'video-meetings';
const SERVER_VERSION = '1.0.0';

/**
 * Owns the single `McpServer`/`StreamableHTTPServerTransport` pair backing the in-process `/mcp`
 * HTTP endpoint (`McpController`) — distinct from `find-tasks-server.ts`'s standalone stdio
 * process, which is a separate entry point spawned as its own subprocess rather than a route on
 * this app. `sessionIdGenerator: undefined` puts the transport in stateless mode (no
 * `Mcp-Session-Id` handshake); `enableJsonResponse: true` makes it answer with a plain JSON body
 * instead of opening an SSE stream, since this endpoint has no long-lived per-client connection to
 * push server-initiated messages over.
 */
@Injectable()
export class McpService implements OnModuleInit {
  private transport: StreamableHTTPServerTransport;

  async onModuleInit(): Promise<void> {
    const server = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(this.transport);
  }

  getTransport(): StreamableHTTPServerTransport {
    return this.transport;
  }
}
