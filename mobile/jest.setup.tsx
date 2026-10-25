// Runs in every test file, after Jest is set up and before the file's own code.

// 15 s, not Jest's 5 s: the first test in a file to reach a screen also pays for loading that
// screen's modules, which can take several seconds on a cold cache.
jest.setTimeout(15_000);

// Skia (the chart's GPU drawing) can't run in Jest, and every screen test loads all of src/app/.
// jest.mock is hoisted above the imports, so it loads react-native itself; the type argument keeps its real type.
jest.mock('@/components/progress-chart', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { ProgressChart: () => <View testID="progress-chart" /> };
});

// The SwiftUI date picker can't render in Jest. Plain Views keep every prop, so tests can fire
// onDateChange. Mocked for every file because any screen test can reach the log screen.
jest.mock('@expo/ui/swift-ui', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const PassThrough = (props: object) => createElement(View, props);
  return { __esModule: true, Host: PassThrough, DatePicker: PassThrough };
});
