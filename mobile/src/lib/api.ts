import { clearDeviceToken, getDeviceToken } from './auth';
import { ApiError, rawRequest } from './http';
import { jobSchema, submitResponseSchema, type Job } from './types';

export { ApiError };

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  return {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  };
}

/**
 * Authenticated request. A 401 means the stored token is no longer valid — the
 * device was removed, or the database was reset — so the app registers again
 * once and retries rather than stranding the user with no way to recover.
 */
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const token = await getDeviceToken();

  try {
    return await rawRequest(path, withAuth(init, token));
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    await clearDeviceToken();
    const freshToken = await getDeviceToken();
    return rawRequest(path, withAuth(init, freshToken));
  }
}

/** POST /api/analyze -> 202 Accepted with the new job id. */
export async function submitPrompt(prompt: string): Promise<string> {
  const json = await request('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  const parsed = submitResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError('API accepted the task but returned an unexpected response.');
  }
  return parsed.data.jobId;
}

/** GET /api/status/:jobId — scoped to the calling device by the backend. */
export async function fetchJob(jobId: string): Promise<Job> {
  const json = await request(`/api/status/${encodeURIComponent(jobId)}`);

  const parsed = jobSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError('API returned an unexpected job shape.');
  }
  return parsed.data;
}
