import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// TextInputProps & { label }: every prop TextInput takes, plus a visible label. The label is also
// the input's accessible name, so tests and screen readers find it with getByLabelText('Reps').
export type TextFieldProps = TextInputProps & { label: string };

export function TextField({ label, style, ...inputProps }: TextFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.field}>
      {/* Hidden from screen readers: the input already announces the label as its name. */}
      <ThemedText type="small" themeColor="textSecondary" importantForAccessibility="no" accessible={false}>
        {label}
      </ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }, style]}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  input: { borderRadius: Spacing.two, padding: Spacing.three, fontSize: 16 },
});
