import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TaskTools } from './task-tools';

const SERVER_NAME = 'video-meetings';
const SERVER_VERSION = '1.0.0';

/**
 * Builds one fresh `McpServer`/`StreamableHTTPServerTransport` pair per HTTP request to `/mcp`
 * (`McpController` calls `createTransport` on every request) — not a single instance shared for
 * the app's lifetime. In stateless mode (`sessionIdGenerator: undefined`), the SDK's own
 * transport refuses a second `handleRequest` call: "Stateless transport cannot be reused across
 * requests. Create a new transport per request." — confirmed by hitting that error directly
 * against an earlier, single-shared-transport version of this service, which answered exactly one
 * request and 500'd every one after. A fresh `McpServer` per request too, rather than reconnecting
 * one long-lived server to each new transport, sidesteps the matching "`Already connected to a
 * transport`" restriction `McpServer.connect` enforces and the message-id collisions the SDK warns
 * a reused server/transport pair would cause under two concurrent requests — this is the same
 * shape the SDK's own `simpleStatelessStreamableHttp.js` example uses. `enableJsonResponse: true`
 * makes each response a plain JSON body instead of an SSE stream, since a request-scoped
 * transport has no long-lived connection to push server-initiated messages over anyway.
 *
 * `TaskTools.registerOn` runs on every fresh server before `connect` — registration only adds
 * handlers to the server's internal maps, so it's cheap and needs no connected transport first.
 * Any future tool/resource provider is wired the same way: inject it here and call its
 * `registerOn(server)` alongside `TaskTools`'s, inside `createTransport`.
 */
@Injectable()
export class McpService {
  constructor(private readonly taskTools: TaskTools) {}

  async createTransport(): Promise<StreamableHTTPServerTransport> {
    const server = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    this.taskTools.registerOn(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport;
  }
}
