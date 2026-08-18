import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

import { ApiError, rawRequest } from './http';

/**
 * Anonymous device authentication (see lib/auth.ts on the backend).
 *
 * On first launch the app registers itself against POST /api/devices and keeps
 * the returned bearer token in the OS keychain. There is no sign-in screen —
 * the token identifies this install, not a person.
 */

const TOKEN_KEY = 'asyncforge.deviceToken';

const registrationSchema = z.object({
  deviceId: z.string(),
  token: z.string(),
});

// SecureStore is backed by the iOS keychain / Android keystore and is not
// implemented for web, where Expo falls back to the browser's storage.
const isWeb = Platform.OS === 'web';

async function readStoredToken(): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function writeStoredToken(token: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

async function deleteStoredToken(): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function register(): Promise<string> {
  const json = await rawRequest('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: Platform.OS }),
  });

  const parsed = registrationSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError('Device registration returned an unexpected response.');
  }

  await writeStoredToken(parsed.data.token);
  return parsed.data.token;
}

// Two screens mounting at once must not register two devices.
let registration: Promise<string> | null = null;

export async function getDeviceToken(): Promise<string> {
  const existing = await readStoredToken();
  if (existing) return existing;

  if (!registration) {
    registration = register().finally(() => {
      registration = null;
    });
  }
  return registration;
}

/** Drops the stored token so the next call registers a fresh device. */
export async function clearDeviceToken(): Promise<void> {
  await deleteStoredToken();
}
