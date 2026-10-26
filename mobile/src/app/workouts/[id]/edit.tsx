import type { WorkoutDetail } from '@shared/models';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { usePressGuard } from '@/hooks/use-press-guard';
import { parseRouteId } from '@/workouts/detail';
import { parseWorkoutForm, workoutFormFrom, type WorkoutForm } from '@/workouts/forms';
import { useWorkout, useWorkoutMutations } from '@/workouts/use-workouts';

// Edit a workout's date and notes. Opens as a sheet (SHEET_OPTIONS in _layout.tsx).
export default function EditWorkoutSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workout = useWorkout(parseRouteId(id));

  if (!workout.data) {
    return (
      <Sheet title="Edit workout">
        <ThemedText themeColor={workout.isError ? 'danger' : 'textSecondary'}>
          {workout.isError ? errorMessage(workout.error) : 'Loading…'}
        </ThemedText>
      </Sheet>
    );
  }
  return <WorkoutEditor workout={workout.data} />;
}

function WorkoutEditor({ workout }: { workout: WorkoutDetail }) {
  const router = useRouter();
  const { updateWorkout } = useWorkoutMutations(workout.id);
  const [form, setForm] = useState<WorkoutForm>(() => workoutFormFrom(workout));
  const [error, setError] = useState<string | null>(null);
  // Shared with Cancel, so a late tap can't also close the workout screen under the sheet.
  const guard = usePressGuard();

  function save() {
    void guard.run(async (leave) => {
      const parsed = parseWorkoutForm(form);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setError(null);
      try {
        await updateWorkout.mutateAsync(parsed.value);
        leave(() => router.back());
      } catch (e: unknown) {
        setError(errorMessage(e));
      }
    });
  }

  return (
    <Sheet title="Edit workout" guard={guard}>
      <TextField
        label="Date"
        placeholder="YYYY-MM-DD"
        value={form.date}
        onChangeText={(date) => setForm((current) => ({ ...current, date }))}
        editable={!updateWorkout.isPending}
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
      />
      <TextField
        label="Notes"
        placeholder="Optional"
        value={form.notes}
        onChangeText={(notes) => setForm((current) => ({ ...current, notes }))}
        editable={!updateWorkout.isPending}
        multiline
        style={{ minHeight: 88, textAlignVertical: 'top' }}
      />

      {error ? (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : null}

      <Button label="Save" loading={updateWorkout.isPending} onPress={save} />
    </Sheet>
  );
}
