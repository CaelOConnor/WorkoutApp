import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useState } from 'react';
import { useColorScheme } from 'react-native';

import { createQueryClient, refetchOnAppForeground } from '@/api/query-client';
import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { SplashScreenController } from '@/auth/splash-screen-controller';

// Once, when the app loads: TanStack Query refetches stale data when the app comes back to the
// foreground.
refetchOnAppForeground();

// Root layout: wraps every screen in src/app/ in the app-wide providers. Order matters:
// AuthProvider uses the query client (to clear it on logout), so it goes inside
// QueryClientProvider, and SplashScreenController and RootNavigator read the auth status, so
// they go inside AuthProvider.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  // useState's initializer runs once, so the cache survives re-renders of this layout.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SplashScreenController />
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootNavigator />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

// A separate component so it can call useAuth(): RootLayout itself is outside AuthProvider.
//
// Stack.Protected: a screen is only reachable while its guard is true. When a guard turns false
// (logging in or out), its screens are dropped from history and the user is sent to the first
// screen that is allowed, so no navigation code is needed after login or logout.
// While the saved token is still being read ('loading') the login group is allowed, but the
// splash screen covers it, and it's replaced as soon as a token is found.
function RootNavigator() {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';

  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Workouts' }} />
        {/* Every signed-in screen must be listed here: a route left out of all the
            Stack.Protected groups would be reachable while signed out. */}
        <Stack.Screen name="workouts/new" options={{ title: 'Log workout' }} />
        <Stack.Screen name="workouts/[id]" options={{ title: 'Workout' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ title: 'Log in' }} />
        <Stack.Screen name="signup" options={{ title: 'Create account' }} />
      </Stack.Protected>
    </Stack>
  );
}
