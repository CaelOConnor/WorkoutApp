import { resolveApiUrl } from './config';

describe('resolveApiUrl', () => {
  it('uses EXPO_PUBLIC_API_URL when it is set', () => {
    expect(
      resolveApiUrl({ envUrl: 'https://api.example.com', hostUri: '192.168.1.5:8081', isDev: true })
    ).toBe('https://api.example.com');
  });

  it('uses EXPO_PUBLIC_API_URL in a production build too', () => {
    expect(
      resolveApiUrl({ envUrl: 'https://api.example.com', hostUri: undefined, isDev: false })
    ).toBe('https://api.example.com');
  });

  it('drops a trailing slash from EXPO_PUBLIC_API_URL', () => {
    // Paths start with '/', so 'http://x:3000/' + '/workouts' would give a double slash.
    expect(resolveApiUrl({ envUrl: 'http://10.0.0.2:3000/', hostUri: undefined, isDev: true })).toBe(
      'http://10.0.0.2:3000'
    );
  });

  it('in dev, uses the LAN IP of the Metro server with the API port', () => {
    expect(resolveApiUrl({ envUrl: undefined, hostUri: '192.168.1.5:8081', isDev: true })).toBe(
      'http://192.168.1.5:3000'
    );
  });

  it('treats an empty EXPO_PUBLIC_API_URL as unset', () => {
    expect(resolveApiUrl({ envUrl: '  ', hostUri: '192.168.1.5:8081', isDev: true })).toBe(
      'http://192.168.1.5:3000'
    );
  });

  it('ignores hostUri outside dev', () => {
    // A release build has no Metro server, so its hostUri says nothing about where the API is.
    expect(() =>
      resolveApiUrl({ envUrl: undefined, hostUri: '192.168.1.5:8081', isDev: false })
    ).toThrow('EXPO_PUBLIC_API_URL');
  });

  it('throws when neither is available', () => {
    expect(() => resolveApiUrl({ envUrl: undefined, hostUri: undefined, isDev: true })).toThrow(
      'EXPO_PUBLIC_API_URL'
    );
  });
});
