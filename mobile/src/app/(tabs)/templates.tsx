import { StyleSheet } from 'react-native';

import { MessageState } from '@/components/query-states';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Placeholder until the templates list (Phase 5, step 8).
export default function TemplatesScreen() {
  return (
    <ThemedView style={styles.screen}>
      <MessageState title="Templates">
        <ThemedText type="small" themeColor="textSecondary">
          Saved workouts you can start from will show up here.
        </ThemedText>
      </MessageState>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
