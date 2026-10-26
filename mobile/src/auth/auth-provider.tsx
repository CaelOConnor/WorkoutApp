// Keeps track of who's logged in, and shares it with every screen through React context.
// Any screen can call useAuth() to get it, without passing it through every screen in between.
import type { AuthBody } from '@shared/models';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';

import { createApiClient, type ApiClient } from '@/api/client';
import { getApiUrl } from '@/api/config';
import { isLoginResponse, isPublicUser } from '@/api/types';

import { deleteToken, loadToken, saveToken } from './token-storage';

// 'loading' only lasts until the saved token has been read. The splash screen covers it.
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  api: ApiClient; // already carries the token
  // These throw the client's errors, for the screen to show.
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// null until AuthProvider supplies a value.
const AuthContext = createContext<AuthContextValue | null>(null);

// The API client, plus the token and the 401 handler it reads.
// Kept outside React state: changing them shouldn't re-render anything.
function createSession() {
  let token: string | null = null;
  let onUnauthorized = () => {};
  const api = createApiClient({
    baseUrl: getApiUrl(),
    getToken: () => token,
    onUnauthorized: () => onUnauthorized(),
  });
  return {
    api,
    setToken(next: string | null) {
      token = next;
    },
    setOnUnauthorized(handler: () => void) {
      onUnauthorized = handler;
    },
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  // The data cache, so logout can clear it. Must be inside QueryClientProvider.
  const queryClient = useQueryClient();
  // Screens react to status. The token itself lives in session.
  const [status, setStatus] = useState<AuthStatus>('loading');
  // Created once, on the first render, and reused after that.
  const [session] = useState(createSession);
  const { api } = session;

  function signIn(token: string) {
    session.setToken(token);
    setStatus('signedIn');
  }

  async function logout() {
    // Sign out right away, even if deleting the saved token is slow or fails.
    session.setToken(null);
    setStatus('signedOut');
    // Clear cached data, so the next user can't see this user's workouts.
    queryClient.clear();
    try {
      await deleteToken();
    } catch {
      // Signed out for this session either way.
    }
  }

  // Any 401 outside login means the token expired, so log out.
  useEffect(() => {
    session.setOnUnauthorized(() => void logout());
  });

  // On launch, read the saved token to decide if the user is still logged in.
  useEffect(() => {
    // Ignore the result if this component goes away before the read finishes.
    let cancelled = false;
    loadToken()
      .catch(() => null) // unreadable storage means logging in again
      .then((token) => {
        if (cancelled) {
          return;
        }
        session.setToken(token);
        setStatus(token ? 'signedIn' : 'signedOut');
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function login(email: string, password: string) {
    const { token } = await api.request('/auth/login', {
      method: 'POST',
      body: { email, password } satisfies AuthBody,
      guard: isLoginResponse,
    });
    // Saved first: if saving fails, the user stays on the login form.
    await saveToken(token);
    signIn(token);
  }

  // Signup returns the new user, not a token, so log in right after.
  async function signup(email: string, password: string) {
    await api.request('/auth/signup', {
      method: 'POST',
      body: { email, password } satisfies AuthBody,
      guard: isPublicUser,
    });
    await login(email, password);
  }

  const value: AuthContextValue = { status, api, login, signup, logout };
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext); // reads the context
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}

export function useApi(): ApiClient {
  return useAuth().api;
}