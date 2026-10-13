import { act } from 'expo-router/testing-library';
import { Alert, type AlertButton } from 'react-native';

// Alert.alert shows a native dialog, which doesn't exist in tests. This records each one without
// answering it, like a dialog the user hasn't tapped yet; answer('Delete') then presses that
// button on the oldest open dialog. `spy` is for checking which dialogs were shown.
export function recordAlerts() {
  const open: AlertButton[][] = [];
  const spy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
      open.push(buttons ?? []);
    });
  return {
    spy,
    async answer(text: string) {
      const buttons = open.shift();
      await act(async () => buttons?.find((b) => b.text === text)?.onPress?.());
    },
  };
}
