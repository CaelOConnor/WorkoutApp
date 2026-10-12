import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  // Shows a spinner and ignores presses, e.g. while a request is in flight.
  loading?: boolean;
  // 'primary' is filled, for the main action on a screen; 'secondary' is outlined.
  variant?: 'primary' | 'secondary';
}

export function Button({ label, onPress, loading = false, variant = 'primary' }: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const textColor = primary ? theme.background : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      // Screen readers announce the role, the name and the state ("Log in, button, dimmed, busy").
      // The name is set explicitly so it stays the same while the spinner is showing.
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
      // style can be a function of the press state, for visual feedback while held down.
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: theme.text }
          : { borderColor: theme.textSecondary, borderWidth: StyleSheet.hairlineWidth },
        (pressed || loading) && styles.dimmed,
      ]}>
      {loading ? <ActivityIndicator color={textColor} /> : null}
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    minHeight: 52,
  },
  dimmed: { opacity: 0.7 },
  label: { fontSize: 16, fontWeight: '600' },
});
