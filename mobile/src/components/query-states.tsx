// What a screen shows while its data isn't there: loading, failed, or a plain message
// (e.g. "Workout not found"). Shared so every screen handles these the same way.
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function LoadingState({ label }: { label: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" accessibilityLabel={label} />
    </View>
  );
}

export interface ErrorStateProps {
  error: unknown;
  onRetry: () => void;
  // True while the retry is running: the button shows a spinner and ignores presses.
  retrying: boolean;
}

export function ErrorState({ error, onRetry, retrying }: ErrorStateProps) {
  return (
    <View style={styles.centered}>
      <ThemedText themeColor="danger" accessibilityRole="alert" style={styles.text}>
        {errorMessage(error)}
      </ThemedText>
      <Button label="Try again" variant="secondary" loading={retrying} onPress={onRetry} />
    </View>
  );
}

// A centered message, with optional extra content (a hint, a button) underneath.
export function MessageState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.centered}>
      <ThemedText style={styles.text}>{title}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  text: { textAlign: 'center' },
});
