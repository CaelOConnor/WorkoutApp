import { fireEvent } from 'expo-router/testing-library';

// fireEvent.press's element type, without importing RNTL's internal types.
type PressTarget = Parameters<typeof fireEvent.press>[0];

// A double-tap: two presses on the same element, with React re-rendering in between, as two taps
// a moment apart do on a phone. The element is found once, so the second tap lands on it even if
// the first one opened another screen on top (the screen underneath stays mounted).
// RNTL skips a press on a disabled element, as a device would, so a button that disables itself
// on the first tap passes this.
export async function doubleTap(element: PressTarget): Promise<void> {
  await fireEvent.press(element);
  await fireEvent.press(element);
}
