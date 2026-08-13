const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface AccessTokenResponse {
  accessToken: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function postJson<TResponse>(
  path: string,
  body: unknown,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : 'Something went wrong. Please try again.';
    throw new ApiError(message, response.status);
  }

  return response.json() as Promise<TResponse>;
}

export function registerUser(
  email: string,
  password: string,
): Promise<AccessTokenResponse> {
  return postJson<AccessTokenResponse>('/auth/register', { email, password });
}
