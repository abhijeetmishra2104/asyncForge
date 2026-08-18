import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Base URL of the AsyncForge Next.js API (the same one the web frontend calls).
 *
 * Set EXPO_PUBLIC_API_URL in mobile/.env to point at a real deployment. Expo
 * inlines EXPO_PUBLIC_* values at bundle time, so it must be read via static
 * dot notation — destructuring or process.env['...'] will not be replaced.
 *
 * When it is not set, the host is derived from Metro's own address rather than
 * hardcoded. In development the API runs on the same machine as the bundler,
 * and Expo already knows how this device reached that machine — so a LAN
 * address that changes between sessions fixes itself. A hardcoded IP does not:
 * it silently breaks the moment DHCP hands out a different one.
 */
const DEV_PORT = 3000;

function devFallbackUrl(): string {
  // e.g. "10.169.67.207:8081" — the host the bundle was actually loaded from.
  const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (metroHost) {
    return `http://${metroHost}:${DEV_PORT}`;
  }

  // Last resort, when hostUri is unavailable (e.g. a production build with no
  // EXPO_PUBLIC_API_URL baked in). "localhost" means something different on
  // every target: the iOS simulator shares the host loopback, the Android
  // emulator maps it to 10.0.2.2, and a physical device can reach neither.
  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${DEV_PORT}`;
  }
  return `http://localhost:${DEV_PORT}`;
}

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? devFallbackUrl()
).replace(/\/$/, '');

/** How often the job screen re-polls /api/status while a job is not terminal. */
export const POLL_INTERVAL_MS = 2000;

/** Requests are aborted after this long; React Native's fetch has no timeout. */
export const REQUEST_TIMEOUT_MS = 15000;
