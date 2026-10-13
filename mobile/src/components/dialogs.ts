// Alert.alert as Promises, so a press handler can `await` the user's answer. That keeps a whole
// flow (ask, then send the request) inside one usePressGuard().run, so a double-tap can't open a
// second dialog while the first is still up.
import { Alert } from 'react-native';

export interface DialogButton {
  text: string;
  // 'cancel' is bold (iOS) and the dismiss action; 'destructive' is red (iOS).
  style?: 'default' | 'cancel' | 'destructive';
}

// Shows a dialog and resolves with the text of the button pressed, or null if it was dismissed
// without one (Android: the back button or a tap outside).
export function ask(
  title: string,
  message: string | undefined,
  buttons: DialogButton[]
): Promise<string | null> {
  // new Promise((resolve) => ...) turns a callback API into a Promise: the dialog's callbacks
  // call resolve, which settles whatever is awaiting it.
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      buttons.map((button) => ({ ...button, onPress: () => resolve(button.text) })),
      // cancelable + onDismiss: on Android, dismissing still resolves, so nothing waits forever.
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

// "Delete this set?" with Cancel and a red confirm button. Resolves true only for the confirm button.
export async function confirm(
  title: string,
  message: string | undefined,
  confirmText: string,
  cancelText = 'Cancel'
): Promise<boolean> {
  const answer = await ask(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: 'destructive' },
  ]);
  return answer === confirmText;
}
