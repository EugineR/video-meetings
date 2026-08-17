import { SetMetadata } from '@nestjs/common';

export const ALLOW_QUERY_TOKEN_KEY = 'allowQueryToken';

/**
 * Marks a route as accepting its access token via a `?token=` query param, in
 * addition to the `Authorization` header — for routes a `<video>`/`<audio>`
 * element's `src` hits directly, where no header can be set. Deliberately
 * opt-in per route (checked by `JwtAuthGuard`) rather than a blanket fallback,
 * so a leaked URL only authenticates the one route it was meant for.
 */
export const AllowQueryToken = () => SetMetadata(ALLOW_QUERY_TOKEN_KEY, true);
