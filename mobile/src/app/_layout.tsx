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
    // Gesture Handler needs a root view to detect touches in; the progress chart's
    // press-and-hold uses it. flex: 1 so it fills the screen like a plain root would.
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

// Screens shown as a sheet that slides up over the current screen: a native iOS form sheet, and
// a bottom sheet on Android. 'fitToContents' sizes it to its content. Android draws no header
// inside a sheet, so it's hidden on both and the screen draws its own title (components/sheet.tsx).
const SHEET_OPTIONS = {
  presentation: 'formSheet',
  sheetAllowedDetents: 'fitToContents',
  sheetGrabberVisible: true,
  headerShown: false,
} as const;

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
        {/* The tab bar (History, Progress, Templates) is one screen of this Stack, so the
            screens below open over it, tab bar included. Its own header is hidden: each tab
            draws one. The title is never shown here, but iOS uses it as the back button's
            label on the next screen, so it follows the focused tab ("Workouts", "Progress"...).
            getFocusedRouteNameFromRoute reads which tab is focused from the tabs' nested state. */}
        <Stack.Screen
          name="(tabs)"
          options={({ route }) => ({
            headerShown: false,
            title: tabTitle(getFocusedRouteNameFromRoute(route)),
          })}
        />
        {/* Every signed-in screen must be listed here: a route left out of all the
            Stack.Protected groups would be reachable while signed out. */}
        <Stack.Screen name="workouts/new" options={{ title: 'Log workout' }} />
        <Stack.Screen name="workouts/[id]/index" options={{ title: 'Workout' }} />
        <Stack.Screen name="workouts/[id]/sets/[setId]" options={SHEET_OPTIONS} />
        <Stack.Screen name="workouts/[id]/edit" options={SHEET_OPTIONS} />
        {/* The screen replaces this title with the exercise's name once it has loaded. */}
        <Stack.Screen name="progress/[exerciseId]" options={{ title: 'Progress' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ title: 'Log in' }} />
        <Stack.Screen name="signup" options={{ title: 'Create account' }} />
      </Stack.Protected>
    </Stack>
  );
}
