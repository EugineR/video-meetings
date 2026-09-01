import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The authenticated caller `McpAuthGuard` (`./guards/mcp-auth.guard.ts`) extracts from the
 * request's JWT (`sub` claim) and that `McpController`/`McpService` thread through to
 * `registerOn` below, so a domain's tool/resource handlers can see who is calling. Identity only
 * for now — no registrar checks it against the data it reads/writes yet (`apps/api/CLAUDE.md`'s
 * Invariants).
 */
export interface McpRequester {
  userId: string;
}

/**
 * The contract every domain's MCP tool/resource registrar implements — one class per domain
 * (`TaskTools` for `tasks/`, ...), each registering that domain's own tools/resources on the
 * `McpServer` it's given. Keeps `McpService`/`McpModule` ignorant of which domains exist: a new
 * domain adds its own registrar class (implementing this interface) and exports it from its own
 * module, rather than editing this file or `mcp.service.ts`.
 *
 * `requester` is the caller `McpAuthGuard` identified for the request this `server` was built for
 * (`McpService.createTransport` builds a fresh server per request — see its own doc comment) — a
 * registrar closes over it in whatever handlers it registers, the same way `TaskTools` does.
 */
export interface McpToolRegistrar {
  registerOn(server: McpServer, requester: McpRequester): void;
}

/**
 * DI token for the aggregated list of every domain's `McpToolRegistrar`. A domain module (e.g.
 * `TasksModule`) provides and exports its own registrar class; `McpModule` imports that module and
 * folds the registrar into this token's `useFactory` (see `mcp.module.ts`) — the one place that
 * knows the full set of domains. `McpService` only ever depends on this token, never on a
 * specific domain's registrar class directly.
 */
export const MCP_TOOL_REGISTRARS = Symbol('MCP_TOOL_REGISTRARS');
