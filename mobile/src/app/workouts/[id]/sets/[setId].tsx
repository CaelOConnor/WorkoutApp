import type { WeightUnit, WorkoutDetailSet } from '@shared/models';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { groupSetsByExercise, parseRouteId } from '@/workouts/detail';
import { parseSetForm, setFormFrom, type SetForm } from '@/workouts/forms';
import { useWorkout, useWorkoutMutations } from '@/workouts/use-workouts';

// Edit or delete one set, shown as a sheet over the workout (see SHEET_OPTIONS in _layout.tsx).
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

  // Find the set, and its position within its exercise for the title ("Squat · Set 2").
  const wantedId = parseRouteId(setId);
  for (const group of groupSetsByExercise(workout.data.sets)) {
    const index = group.sets.findIndex((s) => s.id === wantedId);
    const set = group.sets[index];
    if (set) {
      return (
        // key: a different set gets a fresh form, rather than keeping the last one's typing.
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
  // The form holds text while typing; parseSetForm turns it into numbers on Save.
  // useState(() => ...) computes the starting values on the first render only.
  const [form, setForm] = useState<SetForm>(() => setFormFrom(set));
  const [error, setError] = useState<string | null>(null);
  const busy = updateSet.isPending || deleteSet.isPending;

  // Partial<SetForm>: any subset of the fields, merged over the current ones.
  function update(change: Partial<SetForm>) {
    setForm((current) => ({ ...current, ...change }));
  }

  async function save() {
    const parsed = parseSetForm(form);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    try {
      await updateSet.mutateAsync({ setId: set.id, values: parsed.value });
      router.back();
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }

  function confirmDelete() {
    Alert.alert('Delete this set?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove() },
    ]);
  }

  async function remove() {
    try {
      await deleteSet.mutateAsync(set.id);
      router.back();
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  }

  return (
    <Sheet title={title}>
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

      <Button label="Save" loading={updateSet.isPending} onPress={() => void save()} />
      <Button label="Delete set" variant="danger" loading={deleteSet.isPending} onPress={confirmDelete} />
    </Sheet>
  );
}

const UNITS: WeightUnit[] = ['lb', 'kg'];

// Two options side by side, one selected. Each is a "radio" to screen readers, with its
// checked state, which is how they announce a choose-one-of-several control.
function UnitPicker({ value, onChange }: { value: WeightUnit; onChange: (unit: WeightUnit) => void }) {
  const theme = useTheme();

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Unit" style={styles.row}>
      {UNITS.map((unit) => {
        const selected = unit === value;
        return (
          <Pressable
            key={unit}
            accessibilityRole="radio"
            accessibilityLabel={unit}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(unit)}
            style={[
              styles.unit,
              { backgroundColor: selected ? theme.text : theme.backgroundElement },
            ]}>
            <Text style={[styles.unitText, { color: selected ? theme.background : theme.text }]}>
              {unit}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  grow: { flex: 1 },
  unit: { flex: 1, alignItems: 'center', borderRadius: Spacing.two, padding: Spacing.two },
  unitText: { fontSize: 16, fontWeight: '600' },
});
