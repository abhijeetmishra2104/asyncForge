import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { borderWidth, colors } from '@/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Polling is driven explicitly per-query; nothing here should go stale
      // on its own and cause surprise refetches.
      staleTime: 0,
    },
  },
});

/**
 * React Query's focus tracking is built for the browser, so on native it has to
 * be wired to AppState by hand. Without this, `refetchInterval` keeps firing
 * while the app is backgrounded — burning battery and cellular data polling a
 * screen nobody is looking at.
 */
function useAppStateFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        focusManager.setFocused(status === 'active');
      }
    );
    return () => subscription.remove();
  }, []);
}

export default function RootLayout() {
  useAppStateFocus();

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.yellow },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '900' },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: colors.background,
            borderTopWidth: borderWidth,
            borderTopColor: colors.border,
          },
        }}>
        <Stack.Screen name="index" options={{ title: 'ASYNCFORGE' }} />
        <Stack.Screen name="jobs/[jobId]" options={{ title: 'JOB STATUS' }} />
      </Stack>
    </QueryClientProvider>
  );
}
