"use client";

/**
 * Browser half of the anonymous device auth described in lib/auth.ts.
 *
 * The browser registers itself on first use and keeps the bearer token in
 * localStorage, exactly as the mobile app keeps it in SecureStore. There is no
 * login step; the token identifies this browser profile, nothing more.
 */

const TOKEN_KEY = "asyncforge.deviceToken";

let registration: Promise<string> | null = null;

async function registerDevice(): Promise<string> {
  const res = await fetch("/api/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "web" }),
  });

  if (!res.ok) {
    const message =
      res.status === 429
        ? "Too many registrations from this network. Try again later."
        : "Could not register this browser with the API.";
    throw new Error(message);
  }

  const data = await res.json();
  if (typeof data?.token !== "string") {
    throw new Error("Registration returned an unexpected response.");
  }

  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

export async function getDeviceToken(): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("getDeviceToken is browser-only.");
  }

  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;

  // Two components mounting at once must not register two devices.
  if (!registration) {
    registration = registerDevice().finally(() => {
      registration = null;
    });
  }
  return registration;
}

function withAuth(init: RequestInit | undefined, token: string): RequestInit {
  return {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  };
}

/**
 * fetch() with the device token attached. A 401 means the stored token is no
 * longer valid (revoked, or the database was reset), so the browser re-registers
 * once and retries rather than dead-ending the user.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = await getDeviceToken();
  const res = await fetch(path, withAuth(init, token));

  if (res.status !== 401) return res;

  localStorage.removeItem(TOKEN_KEY);
  const freshToken = await getDeviceToken();
  return fetch(path, withAuth(init, freshToken));
}
