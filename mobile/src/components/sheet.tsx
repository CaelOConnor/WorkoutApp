import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// The frame for a screen presented as a form sheet (see SHEET_OPTIONS in app/_layout.tsx): a
// title row with Cancel, then the content. The title is drawn here rather than in the navigation
// header because Android doesn't render a header inside a sheet.
// No flex: 1 anywhere: the sheet measures its content to decide its height ('fitToContents').
export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();

  return (
    <ThemedView style={styles.sheet}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>
          {title}
        </ThemedText>
        <TextButton label="Cancel" onPress={() => router.back()} />
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
