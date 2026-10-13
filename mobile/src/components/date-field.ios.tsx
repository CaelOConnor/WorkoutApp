// The iOS version of DateField. Metro picks this file over date-field.tsx on iOS (a
// "platform-specific extension"), so the SwiftUI module is never loaded on Android.
import { DatePicker, Host } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { localDateString, localNoon } from '@/workouts/dates';

import type { DateFieldProps } from './date-field';

// A calendar day, picked with SwiftUI's compact DatePicker: a button showing the date that opens
// a calendar popover. See date-field.tsx for how Date and 'YYYY-MM-DD' convert.
export function DateField({ label, value, onChange }: DateFieldProps) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {/* Host is where React Native layout hands over to SwiftUI. matchContents sizes it to the
          picker in both directions, so it's exactly as wide as the date button, and the row's
          space-between puts it at the right edge. flexShrink + minWidth: 0 still let it shrink
          on a very narrow screen rather than run off it. */}
      <Host matchContents style={styles.picker}>
        <DatePicker
          testID="date-picker"
          selection={localNoon(value)}
          displayedComponents={['date']}
          onDateChange={(date) => onChange(localDateString(date))}
          modifiers={[
            datePickerStyle('compact'),
            // A SwiftUI DatePicker reserves space for a title even when it has none, which pushed
            // the date button left. The label is drawn by React Native above, so hide SwiftUI's.
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
