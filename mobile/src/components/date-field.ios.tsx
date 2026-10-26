// Metro picks this file over date-field.tsx on iOS, so the SwiftUI module never loads on Android.
import { DatePicker, Host } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { localDateString, localNoon } from '@/workouts/dates';

import type { DateFieldProps } from './date-field';

// See date-field.tsx for how Date and 'YYYY-MM-DD' convert.
export function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {/* matchContents sizes Host to the picker, so space-between puts it at the right edge.
          flexShrink and minWidth: 0 let it shrink on a narrow screen instead of running off. */}
      <Host matchContents style={styles.picker}>
        <DatePicker
          testID="date-picker"
          selection={localNoon(value)}
          displayedComponents={['date']}
          onDateChange={(date) => onChange(localDateString(date))}
          modifiers={[
            datePickerStyle('compact'),
            // SwiftUI reserves space for a title even when there's none, pushing the date left.
            // The label is drawn above, so hide SwiftUI's.
            labelsHidden(),
          ]}
        />
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  picker: { flexShrink: 1, minWidth: 0 },
});
