import { SplashScreen } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from './auth-provider';

// Module scope, not inside a component: by the time a component renders, the native splash
// screen may already have hidden itself. This runs as soon as the root layout imports this file.
SplashScreen.preventAutoHideAsync();

// Keeps the splash screen up until AuthProvider knows whether a token was saved, so the user
// never sees the login screen flash before the home screen. Renders nothing.
// Must be inside <AuthProvider>.
export function SplashScreenController() {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'loading') {
      SplashScreen.hide();
    }
  }, [status]);

  return null;
}
