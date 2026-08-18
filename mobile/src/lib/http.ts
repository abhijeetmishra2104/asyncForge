import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config';

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Unauthenticated request primitive: URL joining, timeouts, JSON decoding and
 * error normalisation. Kept separate from api.ts so that auth.ts can register a
 * device without importing the authenticated layer that depends on it.
 */
export async function rawRequest(
  path: string,
  init?: RequestInit
): Promise<unknown> {
  // React Native's fetch has no default timeout, so a request to an unreachable
  // host would otherwise hang until the OS gives up.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    // By far the most common failure in development: the device cannot route to
    // the dev machine. Name the URL so the fix is obvious.
    throw new ApiError(
      `Cannot reach the API at ${API_BASE_URL}. Check that the Next.js server is running and that EXPO_PUBLIC_API_URL is reachable from this device.`
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  let json: unknown;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    throw new ApiError(
      `API returned a non-JSON response (HTTP ${response.status}).`,
      response.status
    );
  }

  if (!response.ok) {
    const message =
      json && typeof json === 'object' && typeof (json as any).error === 'string'
        ? (json as any).error
        : `Request failed with HTTP ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return json;
}
