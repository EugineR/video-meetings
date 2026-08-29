import { QueryClient } from '@tanstack/react-query';

/**
 * The app's single `QueryClient`, created by `QueryProvider` in the root layout.
 *
 * Defaults that hold for every query in the app:
 * - `retry: false` — `src/lib/api.ts` throws `ApiError` with the API's own message,
 *   which the UI renders as-is; silently retrying a 401/404 only delays that.
 * - `refetchOnWindowFocus: false` — nothing here is a live dashboard; the meeting
 *   page refetches on its own schedule instead of on every tab switch.
 *
 * Freshness is deliberately left per-query rather than set globally: the session and
 * the profile are cached for the whole session (`staleTime: Infinity`, kept current
 * through `setQueryData` after a save), which would be the wrong default for data
 * that has to catch up to background work on the API.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}
