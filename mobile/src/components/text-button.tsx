import { Pressable, StyleSheet, Text } from 'react-native';

import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface TextButtonProps {
  label: string;
  onPress: () => void;
  // What screen readers say, when the visible label is a symbol or needs context.
  accessibilityLabel?: string;
  disabled?: boolean;
  color?: ThemeColor;
}

// For header buttons and small actions where a full Button would be too heavy.
export function TextButton({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
  color = 'text',
}: TextButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      // The text is small; hitSlop grows the touch area without changing the layout.
      hitSlop={Spacing.two}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]}>
      <Text style={[styles.label, { color: theme[color] }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: Spacing.one },
  dimmed: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '600' },
});
