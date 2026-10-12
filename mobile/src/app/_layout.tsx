import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useState } from 'react';
import { useColorScheme } from 'react-native';

import { createQueryClient, refetchOnAppForeground } from '@/api/query-client';
import { AuthProvider } from '@/auth/auth-provider';
import { SplashScreenController } from '@/auth/splash-screen-controller';

// Once, when the app loads: TanStack Query refetches stale data when the app comes back to the
// foreground.
refetchOnAppForeground();

// Root layout: wraps every screen in src/app/ in the app-wide providers. Order matters:
// AuthProvider uses the query client (to clear it on logout), so it goes inside
// QueryClientProvider, and SplashScreenController reads the auth status, so it goes inside
// AuthProvider. Route guards (Stack.Protected) come in step 4B.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  // useState's initializer runs once, so the cache survives re-renders of this layout.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SplashScreenController />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="index" options={{ title: 'Workouts' }} />
            <Stack.Screen name="signup" options={{ title: 'Sign up' }} />
          </Stack>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
