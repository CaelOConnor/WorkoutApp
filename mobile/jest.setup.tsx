// Runs in every test file, after Jest is set up and before the file's own code.

// Per-test timeout: 15 s instead of Jest's 5 s. The screen tests render the whole app, and the
// first test in a file to reach a screen also pays for loading that screen's modules (seconds on
// this Windows machine). That cost doesn't depend on the test, so it landed on whichever test came
// first and, under load or right after a change (cold transform cache), pushed it past 5 s: the
// occasional single failure ("opens the log workout screen from the header", up to 6.9 s measured
// while the backend tests ran alongside).
jest.setTimeout(15_000);

// The progress chart draws with Skia (GPU), which can't run in Jest. Every screen test loads all
// of src/app/ (renderRouter), so the chart is replaced everywhere, not only in the progress tests.
// It becomes an empty View with a testID: tests can check that a chart is shown, and check the
// data through the list of points the screen shows under it.
// A jest.mock factory is hoisted above the file's imports, so it loads what it needs itself.
// requireActual<typeof import('react-native')> gives the module its real type, where plain
// require() would return `any`.
jest.mock('@/components/progress-chart', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ProgressChart: () => <View testID="progress-chart" /> };
});

// The native date picker can't render in Jest: on iOS (Jest's platform) DateField uses SwiftUI
// views through @expo/ui. These stand-ins are plain Views that keep every prop, so a test can
// fire the picker's onDateChange. Mocked here rather than per file: any screen test can reach the
// log screen (e.g. the history's "+ Log workout"), and the real package takes over a second to
// load. A jest.mock factory runs before the imports, so it loads what it needs with
// jest.requireActual; the type argument gives the result the module's real type.
jest.mock('@expo/ui/swift-ui', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const PassThrough = (props: object) => createElement(View, props);
  return { __esModule: true, Host: PassThrough, DatePicker: PassThrough };
});
