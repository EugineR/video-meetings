import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_TOOL_REGISTRARS, McpToolRegistrar } from './mcp-tool-registrar';

const SERVER_NAME = 'video-meetings';
const SERVER_VERSION = '1.0.0';

/**
 * `buildServer` walks `MCP_TOOL_REGISTRARS` (every domain's `McpToolRegistrar` — see
 * `mcp-tool-registrar.ts`/`mcp.module.ts`) and registers each one's tools/resources on a fresh
 * `McpServer`. `onModuleInit` runs this once at startup purely to fail fast on a registrar wiring
 * bug (e.g. two domains registering the same tool name, which the SDK's `registerTool` throws on
 * synchronously) at boot rather than on the first `/mcp` request — that throwaway server is never
 * connected to a transport or used to serve traffic.
 *
 * `createTransport` builds a **second, real** `McpServer`/`StreamableHTTPServerTransport` pair on
 * **every call** — not a single instance reused across requests. In stateless mode
 * (`sessionIdGenerator: undefined`), the SDK's own transport refuses a second `handleRequest` call:
 * "Stateless transport cannot be reused across requests. Create a new transport per request." —
 * confirmed by hitting that error directly against an earlier, single-shared-transport version of
 * this service, which answered exactly one request and 500'd every one after. A fresh `McpServer`
 * per request too, rather than reconnecting one long-lived server to each new transport, sidesteps
 * the matching "`Already connected to a transport`" restriction `McpServer.connect` enforces and
 * the message-id collisions the SDK warns a reused server/transport pair would cause under two
 * concurrent requests — this is the same shape the SDK's own `simpleStatelessStreamableHttp.js`
 * example uses. `enableJsonResponse: true` makes each response a plain JSON body instead of an SSE
 * stream, since a request-scoped transport has no long-lived connection to push server-initiated
 * messages over anyway.
 */
@Injectable()
export class McpService implements OnModuleInit {
  constructor(
    @Inject(MCP_TOOL_REGISTRARS)
    private readonly registrars: McpToolRegistrar[],
  ) {}

  onModuleInit(): void {
    this.buildServer();
  }

  async createTransport(): Promise<StreamableHTTPServerTransport> {
    const server = this.buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport;
  }

  private buildServer(): McpServer {
    const server = new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    });
    for (const registrar of this.registrars) {
      registrar.registerOn(server);
    }
    return server;
  }
}
