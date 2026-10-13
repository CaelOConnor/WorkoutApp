import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Placeholder for logging a workout (step 5b). Only reachable while signed in.
// A static route wins over the dynamic [id] next to it, so /workouts/new comes here.
export default function LogWorkoutScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText>Logging a workout goes here.</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
});
