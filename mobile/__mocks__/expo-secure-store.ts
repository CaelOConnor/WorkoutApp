// Manual Jest mock for expo-secure-store: an in-memory key-value store.
//
// A file in __mocks__/ next to node_modules/ replaces that package in every test (jest-expo's
// default mock only stubs the native module, so it would return undefined for everything).
// Each function is a jest.fn() wrapping a real implementation, so tests can both rely on it
// behaving like storage and assert how it was called. Only the functions the app uses are here.

const store = new Map<string, string>();

export const getItemAsync = jest.fn(async (key: string): Promise<string | null> => {
  return store.get(key) ?? null;
});

export const setItemAsync = jest.fn(async (key: string, value: string): Promise<void> => {
  store.set(key, value);
});

export const deleteItemAsync = jest.fn(async (key: string): Promise<void> => {
  store.delete(key);
});
