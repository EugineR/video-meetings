const ACCESS_TOKEN_KEY = 'accessToken';

interface JwtPayload {
  sub: string;
  email: string;
  exp: number;
}

export interface StoredUser {
  email: string;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

export function storeAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload || payload.exp * 1000 < Date.now()) {
    clearAccessToken();
    return null;
  }

  return { email: payload.email };
}
