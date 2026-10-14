import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A generic component: <T extends string> lets each use keep its own union type, so
// onChange(value) is typed as Metric on one screen and Range on another, not as plain string.
export interface SegmentedControlProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  // The group's accessible name, e.g. 'Metric'.
  label: string;
}

// Choose one of a few options, shown side by side, like UnitPicker. Each option is a "radio" to
// screen readers, with its checked state.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && { backgroundColor: theme.text }]}>
            <Text
              numberOfLines={1}
              style={[styles.text, { color: selected ? theme.background : theme.text }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: Spacing.two, padding: Spacing.half },
  option: {
    flex: 1,
    alignItems: 'center',
    borderRadius: Spacing.two - Spacing.half,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  text: { fontSize: 14, fontWeight: '600' },
});
