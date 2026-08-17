import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ALLOW_QUERY_TOKEN_KEY } from '../decorators/allow-query-token.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

type RequestWithUser = Request & { user?: JwtPayload };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request, context);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return true;
  }

  private extractToken(
    request: Request,
    context: ExecutionContext,
  ): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) {
      return token;
    }

    // Fallback for routes explicitly marked @AllowQueryToken() — e.g. the
    // recording content route, hit directly by a <video>/<audio> element's
    // `src`, which can't set an Authorization header. Opt-in per route (not a
    // blanket fallback) so a leaked URL only authenticates that one route.
    const allowsQueryToken = this.reflector.get<boolean>(
      ALLOW_QUERY_TOKEN_KEY,
      context.getHandler(),
    );
    if (!allowsQueryToken) {
      return undefined;
    }

    const queryToken = request.query.token;
    return typeof queryToken === 'string' ? queryToken : undefined;
  }
}
