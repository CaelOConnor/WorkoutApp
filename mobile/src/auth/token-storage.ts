import * as SecureStore from 'expo-secure-store';

// The JWT lives in SecureStore (the iOS Keychain / Android Keystore), not plain AsyncStorage,
// because it's a credential: anyone holding it is logged in as the user for 7 days.
// Keys may only contain letters, digits, '.', '-' and '_'.
export const TOKEN_KEY = 'auth.token';

export function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export function saveToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export function deleteToken(): Promise<void> {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}
