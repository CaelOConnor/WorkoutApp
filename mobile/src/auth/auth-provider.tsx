// Who is logged in, shared with every screen through React context.
//
// Context lets a value set high in the tree (here, in the root layout) be read by any component
// below it with useAuth(), without passing props through every screen in between.
import type { AuthBody } from '@shared/models';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';

import { createApiClient, type ApiClient } from '@/api/client';
import { getApiUrl } from '@/api/config';
import { isLoginResponse, isPublicUser } from '@/api/types';

import { deleteToken, loadToken, saveToken } from './token-storage';

// 'loading' only lasts from launch until the saved token has been read (the splash screen covers it).
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  // The API client, already carrying the token. Use it through useApi().
  api: ApiClient;
  // These reject with the client's errors (ApiError, NetworkError, ...) for the screen to show.
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// null until a provider supplies a value; useAuth() turns that into a clear error.
const AuthContext = createContext<AuthContextValue | null>(null);

// The API client plus the two things it needs from the outside: the current token, and what to
// do on a 401. Both live in this closure, outside React: the client reads them in the middle of
// a request, not while rendering, so changing them shouldn't (and doesn't) re-render anything.
function createSession() {
  let token: string | null = null;
  let onUnauthorized = () => {};
  const api = createApiClient({
    baseUrl: getApiUrl(),
    getToken: () => token,
    // Calls whichever handler is registered at the time of the 401.
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
  // The TanStack Query cache, so logout can empty it. AuthProvider must be inside
  // QueryClientProvider.
  const queryClient = useQueryClient();
  // `status` is what screens react to; the token itself is kept in `session`.
  const [status, setStatus] = useState<AuthStatus>('loading');
  // One session for the provider's lifetime: useState runs createSession on the first render
  // only, and returns the same object after that.
  const [session] = useState(createSession);
  const { api } = session;

  function signIn(token: string) {
    session.setToken(token);
    setStatus('signedIn');
  }

  async function logout() {
    // Signed out in memory first, so the screen switches at once and no further request sends
    // the token, even if deleting it from storage is slow or fails.
    session.setToken(null);
    setStatus('signedOut');
    // Drop every cached query: the next user to log in mustn't see this user's workouts.
    queryClient.clear();
    try {
      await deleteToken();
    } catch {
      // Nothing useful to do: the user is signed out for this session either way.
    }
  }

  // Any 401 (other than a wrong password at login) means the token expired or is invalid.
  // Registered in an effect, so it always points at the latest logout.
  // `void` marks the promise as deliberately not awaited: the client expects a plain function.
  useEffect(() => {
    session.setOnUnauthorized(() => void logout());
  });

  // On launch, read the saved token. An effect, because reading SecureStore is async.
  useEffect(() => {
    // If the provider unmounts before the read finishes, ignore the result.
    let cancelled = false;
    loadToken()
      // An unreadable keystore (rare, e.g. after restoring a backup) means logging in again.
      .catch(() => null)
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
      // `satisfies` checks the body against the backend's type without changing its type.
      body: { email, password } satisfies AuthBody,
      guard: isLoginResponse,
    });
    // Saved before signing in: if saving fails, login rejects and the user stays on the form.
    await saveToken(token);
    signIn(token);
  }

  // The backend's signup returns the new user, not a token, so log in straight after.
  async function signup(email: string, password: string) {
    await api.request('/auth/signup', {
      method: 'POST',
      body: { email, password } satisfies AuthBody,
      guard: isPublicUser,
    });
    await login(email, password);
  }

  // A new object every render is fine: the React Compiler (app.json, experiments.reactCompiler)
  // memoizes it, so consumers re-render only when something in it actually changed.
  const value: AuthContextValue = { status, api, login, signup, logout };
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  // use() reads a context like useContext(), and is React 19's preferred form.
  const value = use(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}

export function useApi(): ApiClient {
  return useAuth().api;
}
