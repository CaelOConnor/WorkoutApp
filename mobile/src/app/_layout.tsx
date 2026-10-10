import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

// Root layout: every screen in src/app/ is a route in this one Stack (screens push on top of
// each other, with a back button). Auth providers and route guards are added here in step 4.
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Workouts' }} />
        <Stack.Screen name="signup" options={{ title: 'Sign up' }} />
      </Stack>
    </ThemeProvider>
  );
}
