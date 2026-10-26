import type { WeightUnit } from '@shared/models';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const UNITS: WeightUnit[] = ['lb', 'kg'];

export interface UnitPickerProps {
  value: WeightUnit;
  onChange: (unit: WeightUnit) => void;
  // The group's accessible name, e.g. 'Squat set 2 unit' when there are several on a screen.
  label?: string;
  // 'compact' for a row with other inputs, where the full-width version wouldn't fit.
  size?: 'full' | 'compact';
}

// Radio roles are how screen readers announce a choose-one control.
export function UnitPicker({ value, onChange, label = 'Unit', size = 'full' }: UnitPickerProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[styles.row, size === 'compact' && styles.compactRow]}>
      {UNITS.map((unit) => {
        const selected = unit === value;
        return (
          <Pressable
            key={unit}
            accessibilityRole="radio"
            accessibilityLabel={unit}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(unit)}
            style={[
              styles.unit,
              size === 'compact' && styles.compactUnit,
              { backgroundColor: selected ? theme.text : theme.backgroundElement },
            ]}>
            <Text style={[styles.unitText, { color: selected ? theme.background : theme.text }]}>
              {unit}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  compactRow: { gap: Spacing.one },
  unit: { flex: 1, alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.two },
  compactUnit: { flex: 0, paddingHorizontal: Spacing.two, paddingVertical: Spacing.three },
  unitText: { fontSize: 16, fontWeight: '600' },
});
