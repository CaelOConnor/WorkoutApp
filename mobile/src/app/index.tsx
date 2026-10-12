import { StyleSheet } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

// Placeholder for the workout history screen (step 5a). Only reachable while signed in.
export default function HistoryScreen() {
  const { logout } = useAuth();

  return (
    <ThemedView style={styles.container}>
      <ThemedText>Workout history goes here.</ThemedText>
      {/* Logging out flips the auth status; Stack.Protected then shows the login screen. */}
      <Button label="Log out" variant="secondary" onPress={() => void logout()} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
  },
});
