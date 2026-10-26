import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard, type PressGuard } from '@/hooks/use-press-guard';

// The title is drawn here because Android shows no header inside a sheet.
// No flex: 1 anywhere: the sheet measures its content to set its height.
export function Sheet({
  title,
  guard,
  children,
}: {
  title: string;
  // The content's guard, so Cancel can't run during a save and a double tap closes only the sheet.
  guard?: PressGuard;
  children: ReactNode;
}) {
  const router = useRouter();
  // Hooks must run on every render, so this one always does, even when `guard` is passed.
  const ownGuard = usePressGuard();
  const { navigate } = guard ?? ownGuard;

  return (
    <ThemedView style={styles.sheet}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>
          {title}
        </ThemedText>
        <TextButton label="Cancel" onPress={() => navigate(() => router.back())} />
      </View>
      {children}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: Spacing.four, gap: Spacing.three },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, flexShrink: 1 },
});
