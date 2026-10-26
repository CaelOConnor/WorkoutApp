import type { Exercise } from '@shared/models';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { useCreateExercise } from '@/workouts/use-exercises';

export interface CreateExerciseFormProps {
  // The picker's search text.
  initialName: string;
  // Quick choices for the muscle group, e.g. the ones existing exercises use.
  muscleGroups: readonly string[];
  onCreated: (exercise: Exercise) => void;
}

// The muscle group is free text, with existing groups as one-tap choices so the same group isn't
// spelled three ways.
export function CreateExerciseForm({ initialName, muscleGroups, onCreated }: CreateExerciseFormProps) {
  const theme = useTheme();
  const createExercise = useCreateExercise();
  // Stops a double tap on Create from sending two requests.
  const guard = usePressGuard();
  const [name, setName] = useState(initialName);
  const [muscleGroup, setMuscleGroup] = useState('');

  const trimmedName = name.trim();
  const trimmedGroup = muscleGroup.trim();

  // The error was about what was sent, like a duplicate name, so any edit clears it.
  function edit(apply: () => void) {
    apply();
    createExercise.reset();
  }

  // Ignores case, so typed text that matches a choice shows it as selected.
  function isChosen(group: string) {
    return trimmedGroup.toLowerCase() === group.toLowerCase();
  }

  function submit() {
    void guard.run(async () => {
      try {
        // The catch only stops an unhandled rejection: createExercise.error already holds it for
        // the message below.
        const exercise = await createExercise.mutateAsync({
          name: trimmedName,
          muscle_group: trimmedGroup || null,
        });
        onCreated(exercise);
      } catch {}
    });
  }

  return (
    // Lets a tap on a choice or on Create go through while the keyboard is up.
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="Name"
        value={name}
        onChangeText={(text) => edit(() => setName(text))}
        autoCapitalize="words"
        autoCorrect={false}
      />
      <TextField
        label="Muscle group"
        placeholder="Optional"
        value={muscleGroup}
        onChangeText={(text) => edit(() => setMuscleGroup(text))}
        autoCapitalize="words"
        autoCorrect={false}
      />
      {muscleGroups.length > 0 ? (
        // Radios to screen readers, but unlike SegmentedControl they wrap and none has to be chosen.
        <View accessibilityRole="radiogroup" accessibilityLabel="Muscle group choices" style={styles.choices}>
          {muscleGroups.map((group) => {
            const chosen = isChosen(group);
            return (
              <Pressable
                key={group}
                accessibilityRole="radio"
                accessibilityLabel={group}
                accessibilityState={{ checked: chosen }}
                onPress={() => edit(() => setMuscleGroup(chosen ? '' : group))}
                style={[
                  styles.choice,
                  { backgroundColor: chosen ? theme.text : theme.backgroundElement },
                ]}>
                <Text style={[styles.choiceText, { color: chosen ? theme.background : theme.text }]}>
                  {group}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {createExercise.isError ? (
        <ThemedText
          type="small"
          themeColor="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite">
          {errorMessage(createExercise.error)}
        </ThemedText>
      ) : null}
      <Button
        label="Create"
        disabled={trimmedName === ''}
        loading={createExercise.isPending}
        onPress={submit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  choice: { borderRadius: Spacing.four, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  choiceText: { fontSize: 14, fontWeight: '600' },
});
