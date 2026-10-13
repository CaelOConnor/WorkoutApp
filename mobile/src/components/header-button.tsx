import { Pressable, StyleSheet, Text } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface HeaderButtonProps {
  label: string;
  onPress: () => void;
  // The name screen readers announce, when it should differ from the visible label
  // (e.g. '+ Log workout' is read as 'Log workout').
  accessibilityLabel?: string;
}

// A text button for the navigation header (headerLeft / headerRight).
export function HeaderButton({ label, onPress, accessibilityLabel }: HeaderButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      // Header text is small; hitSlop grows the touch area without changing the layout.
      hitSlop={Spacing.two}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: Spacing.one },
  pressed: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '600' },
});
