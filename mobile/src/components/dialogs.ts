// Alert.alert as Promises, so a whole flow (ask, then send) fits in one usePressGuard().run and a
// double tap can't open a second dialog.
import { Alert } from 'react-native';

export interface DialogButton {
  text: string;
  // 'cancel' is bold (iOS) and the dismiss action; 'destructive' is red (iOS).
  style?: 'default' | 'cancel' | 'destructive';
}

// Resolves with the pressed button's text, or null if dismissed without one (Android's back
// button or a tap outside).
export function ask(
  title: string,
  message: string | undefined,
  buttons: DialogButton[]
): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      buttons.map((button) => ({ ...button, onPress: () => resolve(button.text) })),
      // On Android, dismissing still resolves, so nothing waits forever.
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

// Resolves true only for the confirm button.
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
