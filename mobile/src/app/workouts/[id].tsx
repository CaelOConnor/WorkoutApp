import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Placeholder for one workout's details, with edit and delete to come. Only reachable while
// signed in. [id] in the file name is a dynamic segment: /workouts/3 opens this with id '3'.
export default function WorkoutDetailScreen() {
  // URL params are always strings. The type argument describes them; it isn't checked at runtime.
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ThemedView style={styles.container}>
      <ThemedText>Workout {id} goes here.</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
});
