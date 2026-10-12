import { useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface AuthFormProps {
  submitLabel: string;
  // Tells the OS password manager whether to offer a saved password or suggest a new one.
  passwordAutoComplete: 'current-password' | 'new-password';
  // Should reject on failure; the form shows the error and lets the user try again.
  onSubmit: (email: string, password: string) => Promise<void>;
  // Shown under the button, e.g. a link to the other auth screen.
  footer?: ReactNode;
}

// The email + password form shared by the login and signup screens.
export function AuthForm({ submitLabel, passwordAutoComplete, onSubmit, footer }: AuthFormProps) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A ref to the password field, so "next" on the email keyboard can move the cursor there.
  // useRef<TextInput>(null) is typed as RefObject<TextInput | null>: empty until it mounts.
  const passwordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (submitting) {
      return;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // On success, the auth status changes and Stack.Protected swaps this screen for the home
      // screen, so there's nothing else to do here.
      await onSubmit(trimmedEmail, password);
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }];

  return (
    <ThemedView style={styles.screen}>
      {/* Moves the form up when the keyboard opens, so the button stays visible on iOS. */}
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.form}>
          <TextInput
            style={inputStyle}
            accessibilityLabel="Email"
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            value={email}
            onChangeText={setEmail}
            editable={!submitting}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
          />
          <TextInput
            ref={passwordRef}
            style={inputStyle}
            accessibilityLabel="Password"
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            value={password}
            onChangeText={setPassword}
            editable={!submitting}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={passwordAutoComplete}
            textContentType={passwordAutoComplete === 'new-password' ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={() => void handleSubmit()}
          />

          {error ? (
            // A live region: screen readers announce the error as soon as it appears.
            <ThemedText
              type="small"
              themeColor="danger"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite">
              {error}
            </ThemedText>
          ) : null}

          <Button label={submitLabel} loading={submitting} onPress={() => void handleSubmit()} />

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  form: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  input: { borderRadius: Spacing.two, padding: Spacing.three, fontSize: 16 },
  footer: { alignItems: 'center' },
});
