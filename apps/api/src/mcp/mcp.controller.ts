import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { McpService } from './mcp.service';

/**
 * Not yet authenticated — every JSON-RPC method the connected `McpServer` exposes is reachable by
 * any caller that can reach this route. Closing that gap is left for a follow-up change.
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @All()
  async handleRequest(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const transport = await this.mcpService.createTransport();
    res.on('close', () => {
      transport.close().catch(() => undefined);
    });
    await transport.handleRequest(req, res, req.body);
  }
}
