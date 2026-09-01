import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { McpRequester } from '../mcp-tool-registrar';

export type RequestWithRequester = Request & { requester?: McpRequester };

/**
 * Same JWT validation as `JwtAuthGuard` (shared `JwtService`, no separate IdP), but stores the
 * caller under `req.requester` rather than `req.user` — `McpController`'s handler is a bare
 * JSON-RPC passthrough with no `@CurrentUser()`-style param decorator, so it reads `req.requester`
 * directly and threads it into `McpService.createTransport`, which passes it to every domain's
 * `McpToolRegistrar.registerOn` (see `../mcp-tool-registrar.ts`) — that's how it reaches
 * `TaskTools`'s `find_tasks`/`upsert_task`/`tasks://open`/`task://{id}` handlers.
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithRequester>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.requester = { userId: payload.sub };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
