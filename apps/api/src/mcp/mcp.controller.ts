import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpAuthGuard } from './guards/mcp-auth.guard';
import { McpRequester } from './mcp-tool-registrar';
import { McpService } from './mcp.service';

/** `McpAuthGuard` always sets `requester` before a request reaches this controller. */
type AuthenticatedRequest = Request & { requester: McpRequester };

/**
 * `McpAuthGuard` requires a valid Bearer JWT and identifies the caller (`req.requester`), which
 * `handleRequest` reads and forwards to `McpService.createTransport` so it reaches every
 * registered tool/resource handler — but that's authentication only — none of them (e.g.
 * `TaskTools`'s `find_tasks`/`upsert_task`) check `requester.userId` against the data they read or
 * write yet. See `apps/api/CLAUDE.md`'s Invariants.
 */
@UseGuards(McpAuthGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  async handleRequest(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const transport = await this.mcpService.createTransport(req.requester);
    res.on('close', () => {
      transport.close().catch(() => undefined);
    });
    await transport.handleRequest(req, res, req.body);
  }
}
