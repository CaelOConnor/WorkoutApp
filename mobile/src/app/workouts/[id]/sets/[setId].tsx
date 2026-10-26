import type { WorkoutDetailSet } from '@shared/models';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { confirm } from '@/components/dialogs';
import { Sheet } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { UnitPicker } from '@/components/unit-picker';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { groupSetsByExercise, parseRouteId } from '@/workouts/detail';
import { parseSetForm, setFormFrom, type SetForm } from '@/workouts/forms';
import { useWorkout, useWorkoutMutations } from '@/workouts/use-workouts';

// The workout usually comes straight from the cache, since the detail screen just loaded it.
export default function EditSetSheet() {
  const { id, setId } = useLocalSearchParams<{ id: string; setId: string }>();
  const workoutId = parseRouteId(id);
  const workout = useWorkout(workoutId);

  if (!workout.data) {
    return (
      <Sheet title="Edit set">
        <ThemedText themeColor={workout.isError ? 'danger' : 'textSecondary'}>
          {workout.isError ? errorMessage(workout.error) : 'Loading…'}
        </ThemedText>
      </Sheet>
    );
  }

  // Also finds the set's position within its exercise, for the title.
  const wantedId = parseRouteId(setId);
  for (const group of groupSetsByExercise(workout.data.sets)) {
    const index = group.sets.findIndex((s) => s.id === wantedId);
    const set = group.sets[index];
    if (set) {
      return (
        // The key gives a different set a fresh form instead of keeping the last one's typing.
        <SetEditor
          key={set.id}
          workoutId={workout.data.id}
          set={set}
          title={`${group.exerciseName} · Set ${index + 1}`}
        />
      );
    }
  }
  return (
    <Sheet title="Edit set">
      <ThemedText>Set not found</ThemedText>
    </Sheet>
  );
}

interface SetEditorProps {
  workoutId: number;
  set: WorkoutDetailSet;
  title: string;
}

function SetEditor({ workoutId, set, title }: SetEditorProps) {
  const router = useRouter();
  const { updateSet, deleteSet } = useWorkoutMutations(workoutId);
  // Text while typing. parseSetForm turns it into numbers on Save.
  const [form, setForm] = useState<SetForm>(() => setFormFrom(set));
  const [error, setError] = useState<string | null>(null);
  const busy = updateSet.isPending || deleteSet.isPending;
  // Shared by Save, Delete and Cancel. After a success it stays locked while the sheet closes,
  // so a late tap can't also close the workout screen under it.
  const guard = usePressGuard();

  function update(change: Partial<SetForm>) {
    setForm((current) => ({ ...current, ...change }));
  }

  function save() {
    void guard.run(async (leave) => {
      const parsed = parseSetForm(form);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setError(null);
      try {
        await updateSet.mutateAsync({ setId: set.id, values: parsed.value });
        leave(() => router.back());
      } catch (e: unknown) {
        setError(errorMessage(e));
      }
    });
  }

  function remove() {
    void guard.run(async (leave) => {
      if (!(await confirm('Delete this set?', undefined, 'Delete'))) {
        return;
      }
      try {
        await deleteSet.mutateAsync(set.id);
        leave(() => router.back());
      } catch (e: unknown) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Sheet title={title} guard={guard}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField
            label="Reps"
            value={form.reps}
            onChangeText={(reps) => update({ reps })}
            keyboardType="number-pad"
            editable={!busy}
            selectTextOnFocus
          />
        </View>
        <View style={styles.grow}>
          <TextField
            label="Weight"
            value={form.weight}
            onChangeText={(weight) => update({ weight })}
            keyboardType="decimal-pad"
            editable={!busy}
            selectTextOnFocus
          />
        </View>
      </View>
      <UnitPicker value={form.unit} onChange={(unit) => update({ unit })} />

      {error ? (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}

      <Button label="Save" loading={updateSet.isPending} onPress={save} />
      <Button label="Delete set" variant="danger" loading={deleteSet.isPending} onPress={remove} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  grow: { flex: 1 },
});
