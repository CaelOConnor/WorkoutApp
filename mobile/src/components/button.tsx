import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  // Shows a spinner and ignores presses, e.g. while a request is in flight.
  loading?: boolean;
  // Ignores presses and looks dimmed, without a spinner (e.g. Save before the form is valid).
  disabled?: boolean;
  // The name screen readers announce, when it should differ from the label
  // (e.g. '+ Add exercise' is read as 'Add exercise').
  accessibilityLabel?: string;
  // 'primary' is filled, for the main action on a screen; 'secondary' is outlined; 'danger' is
  // outlined in red, for deleting.
  variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const outlineColor = variant === 'danger' ? theme.danger : theme.textSecondary;
  const textColor = primary ? theme.background : variant === 'danger' ? theme.danger : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      // Screen readers announce the role, the name and the state ("Log in, button, dimmed, busy").
      // The name is set explicitly so it stays the same while the spinner is showing.
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: loading || disabled, busy: loading }}
      // style can be a function of the press state, for visual feedback while held down.
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: theme.text }
          : { borderColor: outlineColor, borderWidth: StyleSheet.hairlineWidth },
        (pressed || loading) && styles.dimmed,
        disabled && !loading && styles.disabled,
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
  disabled: { opacity: 0.4 },
  label: { fontSize: 16, fontWeight: '600' },
});
