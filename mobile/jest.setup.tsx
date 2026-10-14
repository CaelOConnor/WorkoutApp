// Runs in every test file, after Jest is set up and before the file's own code.

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
