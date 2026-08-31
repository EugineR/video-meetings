import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The contract every domain's MCP tool/resource registrar implements — one class per domain
 * (`TaskTools` for `tasks/`, ...), each registering that domain's own tools/resources on the
 * `McpServer` it's given. Keeps `McpService`/`McpModule` ignorant of which domains exist: a new
 * domain adds its own registrar class (implementing this interface) and exports it from its own
 * module, rather than editing this file or `mcp.service.ts`.
 */
export interface McpToolRegistrar {
  registerOn(server: McpServer): void;
}

/**
 * DI token for the aggregated list of every domain's `McpToolRegistrar`. A domain module (e.g.
 * `TasksModule`) provides and exports its own registrar class; `McpModule` imports that module and
 * folds the registrar into this token's `useFactory` (see `mcp.module.ts`) — the one place that
 * knows the full set of domains. `McpService` only ever depends on this token, never on a
 * specific domain's registrar class directly.
 */
export const MCP_TOOL_REGISTRARS = Symbol('MCP_TOOL_REGISTRARS');
