import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { getFocusedRouteNameFromRoute } from 'expo-router/react-navigation';
import { useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { createQueryClient, refetchOnAppForeground } from '@/api/query-client';
import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { SplashScreenController } from '@/auth/splash-screen-controller';
import { tabTitle } from '@/navigation/tabs';

// Refresh data when the app comes back to the foreground. Set up once, when the app loads.
refetchOnAppForeground();

// The root of the app: wraps every screen in the providers.
// Order matters: each provider can use the ones outside it.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  // Created once, so the cache isn't lost on re-render.
  const [queryClient] = useState(createQueryClient);

  return (
    // Needed for touch gestures, like press-and-hold on the progress chart.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SplashScreenController />
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootNavigator />
          </ThemeProvider>
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// Screens that slide up from the bottom instead of opening full screen.
// They draw their own title, since Android shows no header in a sheet.
const SHEET_OPTIONS = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  headerShown: false,
} as const;

// Its own component so it can use useAuth(), since RootLayout is outside AuthProvider.
// Stack.Protected only allows its screens while the guard is true. Logging in or out
// flips the guards, and the app moves to an allowed screen on its own.
function RootNavigator() {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';

  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        {/* The tab bar is one screen, so the screens below open on top of it.
            The title isn't shown, but iOS uses it as the back button label. */}
        <Stack.Screen
          name="(tabs)"
          options={({ route }) => ({
            headerShown: false,
            title: tabTitle(getFocusedRouteNameFromRoute(route)),
          })}
        />
        {/* Every signed-in screen must be listed here, or it's reachable while signed out. */}
        <Stack.Screen name="workouts/start" options={SHEET_OPTIONS} />
        <Stack.Screen name="workouts/new" options={{ title: 'Log workout' }} />
        <Stack.Screen name="workouts/[id]/index" options={{ title: 'Workout' }} />
        <Stack.Screen name="workouts/[id]/sets/[setId]" options={SHEET_OPTIONS} />
        <Stack.Screen name="workouts/[id]/edit" options={SHEET_OPTIONS} />
        {/* Replaced with the exercise's name once it loads. */}
        <Stack.Screen name="progress/[exerciseId]" options={{ title: 'Progress' }} />
        <Stack.Screen name="templates/new" options={{ title: 'New template' }} />
        {/* Replaced with the template's name once it loads. */}
        <Stack.Screen name="templates/[id]/index" options={{ title: 'Template' }} />
        <Stack.Screen name="templates/[id]/edit" options={{ title: 'Edit template' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ title: 'Log in' }} />
        <Stack.Screen name="signup" options={{ title: 'Create account' }} />
      </Stack.Protected>
    </Stack>
  );
}