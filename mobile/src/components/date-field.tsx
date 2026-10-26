// The Android DateField. TypeScript only sees this file, not the .ios one, so its props type is
// the one both share.
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate, localDateString, localNoon } from '@/workouts/dates';

export interface DateFieldProps {
  label: string;
  value: string; // 'YYYY-MM-DD'
  onChange: (date: string) => void;
}

// The picker works in local time, the zone the user means when they pick "Tuesday".
// localNoon and localDateString convert to and from 'YYYY-MM-DD'.
export function DateField({ label, value, onChange }: DateFieldProps) {
  const theme = useTheme();
  // The picker opens as a dialog when it mounts, so it's only rendered while open.
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatFullDate(value)}`}
        accessibilityHint="Opens a calendar"
        onPress={() => setOpen(true)}
        style={[styles.button, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText numberOfLines={1}>{formatFullDate(value)}</ThemedText>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={localNoon(value)}
          mode="date"
          presentation="dialog"
          onValueChange={(_event, date) => {
            setOpen(false);
            onChange(localDateString(date));
          }}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
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
  // Can shrink (with the date cut short) rather than push past the screen edge.
  button: {
    flexShrink: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
