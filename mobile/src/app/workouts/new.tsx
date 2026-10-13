import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useReducer, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { DateField } from '@/components/date-field';
import { confirm } from '@/components/dialogs';
import { ExercisePicker } from '@/components/exercise-picker';
import { TextButton } from '@/components/text-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UnitPicker } from '@/components/unit-picker';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { localDateString } from '@/workouts/dates';
import {
  createLogForm,
  hasChanges,
  logFormReducer,
  validateLogForm,
  type LogAction,
  type LogExercise,
  type LogSet,
  type SetErrors,
} from '@/workouts/log-form';
import { useCreateWorkout } from '@/workouts/use-workouts';

// Log a new workout: date, notes, and exercises with their sets, saved in one POST /workouts.
// Only reachable while signed in.
export default function LogWorkoutScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  // "Today" on the phone's calendar, fixed when the screen opens. useState's initializer runs once.
  const [today] = useState(() => localDateString());
  // useReducer(reducer, initialArg, init): init(initialArg) builds the first state, once.
  // dispatch(action) then runs the reducer (src/workouts/log-form.ts) and re-renders.
  const [form, dispatch] = useReducer(logFormReducer, today, createLogForm);
  // True after the first press of Save: from then on, empty fields show their errors too.
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const createWorkout = useCreateWorkout();
  const guard = usePressGuard();
  // Set just before leaving after a save, so the discard check below lets that navigation through.
  // A ref, not state: it must be readable in the same moment, before any re-render.
  const saved = useRef(false);

  const validation = validateLogForm(form);

  // Runs whenever this screen is about to be removed while `preventRemove` is true: the back
  // button, the iOS swipe, Android's back key, or router.replace after saving. The removal is
  // put on hold; navigation.dispatch(data.action) lets it continue.
  usePreventRemove(hasChanges(form, today), ({ data }) => {
    if (saved.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirm(
      'Discard this workout?',
      "The exercises and sets you've entered will be lost.",
      'Discard',
      'Keep editing'
    ).then((discard) => {
      if (discard) {
        navigation.dispatch(data.action);
      }
    });
  });

  function save() {
    // Through the guard: a double-tap sends one request, and the screen stays locked while it
    // leaves. (`form` here is the state this render saw, which is what the user just tapped on.)
    void guard.run(async (leave) => {
      setSubmitted(true);
      setSaveError(null);
      const { body } = validateLogForm(form);
      if (!body) {
        return;
      }
      try {
        const { id } = await createWorkout.mutateAsync(body);
        saved.current = true;
        // replace, not push: the log screen leaves the stack, so back from the new workout goes
        // to the history rather than to a filled-in form for a workout that's already saved.
        leave(() => router.replace({ pathname: '/workouts/[id]', params: { id: String(id) } }));
      } catch (e: unknown) {
        setSaveError(errorMessage(e));
      }
    });
  }

  // An error is shown next to its field once the field has text, or after Save was pressed, so a
  // fresh empty row isn't red before the user has typed anything.
  function visibleError(text: string, error: string | null): string | null {
    return submitted || text.trim() !== '' ? error : null;
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // iOS: scrolls the focused input above the keyboard.
        automaticallyAdjustKeyboardInsets>
        <DateField
          label="Date"
          value={form.date}
          onChange={(date) => dispatch({ type: 'setDate', date })}
        />
        {validation.dateError ? <FieldError message={validation.dateError} /> : null}
        <TextField
          label="Notes"
          placeholder="Optional"
          value={form.notes}
          onChangeText={(notes) => dispatch({ type: 'setNotes', notes })}
          multiline
        />

        {form.exercises.length === 0 ? (
          <ThemedText themeColor="textSecondary">Add an exercise to start.</ThemedText>
        ) : null}

        {form.exercises.map((exercise) => (
          <ExerciseCard
            key={exercise.key}
            exercise={exercise}
            dispatch={dispatch}
            errorsFor={(set) => {
              const errors = validation.setErrors.get(set.key);
              return {
                reps: visibleError(set.reps, errors?.reps ?? null),
                weight: visibleError(set.weight, errors?.weight ?? null),
              };
            }}
          />
        ))}

        <Button
          label="+ Add exercise"
          accessibilityLabel="Add exercise"
          variant="secondary"
          onPress={() => setPickerOpen(true)}
        />

        {saveError ? <FieldError message={saveError} /> : null}
        <Button
          label="Save workout"
          // Enabled once one set is valid. Pressing it with other sets still invalid shows their
          // errors instead of saving (see validateLogForm).
          disabled={validation.validSetCount === 0}
          loading={createWorkout.isPending}
          onPress={save}
        />
      </ScrollView>

      <ExercisePicker
        visible={pickerOpen}
        excludeIds={form.exercises.map((e) => e.exerciseId)}
        onClose={() => setPickerOpen(false)}
        onPick={(exercise) => {
          dispatch({ type: 'addExercise', exercise });
          setPickerOpen(false);
        }}
      />
    </ThemedView>
  );
}

interface ExerciseCardProps {
  exercise: LogExercise;
  // React.Dispatch<LogAction> is the type of useReducer's dispatch for this reducer.
  dispatch: React.Dispatch<LogAction>;
  errorsFor: (set: LogSet) => SetErrors;
}

function ExerciseCard({ exercise, dispatch, errorsFor }: ExerciseCardProps) {
  const { key: exerciseKey, name } = exercise;

  return (
    <ThemedView type="backgroundElement" style={styles.card} testID={`${name} card`}>
      <View style={styles.cardHeader}>
        <ThemedText type="smallBold" style={styles.exerciseName}>
          {name}
        </ThemedText>
        <TextButton
          label="Remove"
          accessibilityLabel={`Remove ${name}`}
          color="danger"
          onPress={() => dispatch({ type: 'removeExercise', exerciseKey })}
        />
      </View>

      {exercise.sets.map((set, index) => (
        <SetRow
          key={set.key}
          // "Squat set 2": names each input for screen readers (and tests) among many alike.
          label={`${name} set ${index + 1}`}
          number={index + 1}
          set={set}
          errors={errorsFor(set)}
          onChange={(change) =>
            dispatch({ type: 'updateSet', exerciseKey, setKey: set.key, change })
          }
          onRemove={() => dispatch({ type: 'removeSet', exerciseKey, setKey: set.key })}
        />
      ))}

      <View style={styles.cardFooter}>
        <TextButton
          label="+ Add set"
          accessibilityLabel={`Add ${name} set`}
          onPress={() => dispatch({ type: 'addSet', exerciseKey })}
        />
      </View>
    </ThemedView>
  );
}

interface SetRowProps {
  label: string;
  number: number;
  set: LogSet;
  errors: SetErrors;
  onChange: (change: Partial<Omit<LogSet, 'key'>>) => void;
  onRemove: () => void;
}

function SetRow({ label, number, set, errors, onChange, onRemove }: SetRowProps) {
  const theme = useTheme();

  // Same look as TextField, without its label above (the row has room for one line only).
  function inputStyle(error: string | null) {
    return [
      styles.input,
      { backgroundColor: theme.background, color: theme.text },
      error ? { borderColor: theme.danger, borderWidth: 1 } : null,
    ];
  }

  return (
    <View style={styles.setBlock}>
      <View style={styles.setRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.setNumber}>
          Set {number}
        </ThemedText>
        <TextInput
          accessibilityLabel={`${label} reps`}
          placeholder="Reps"
          placeholderTextColor={theme.textSecondary}
          value={set.reps}
          onChangeText={(reps) => onChange({ reps })}
          keyboardType="number-pad"
          style={inputStyle(errors.reps)}
        />
        <TextInput
          accessibilityLabel={`${label} weight`}
          placeholder="Weight"
          placeholderTextColor={theme.textSecondary}
          value={set.weight}
          onChangeText={(weight) => onChange({ weight })}
          keyboardType="decimal-pad"
          style={inputStyle(errors.weight)}
        />
        <UnitPicker
          label={`${label} unit`}
          size="compact"
          value={set.unit}
          onChange={(unit) => onChange({ unit })}
        />
        <TextButton
          label="✕"
          accessibilityLabel={`Remove ${label}`}
          color="textSecondary"
          onPress={onRemove}
        />
      </View>
      {errors.reps ? <FieldError message={errors.reps} /> : null}
      {errors.weight ? <FieldError message={errors.weight} /> : null}
    </View>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    // A live region: screen readers announce the message as soon as it appears.
    <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  exerciseName: { fontSize: 16, flexShrink: 1 },
  setBlock: { gap: Spacing.one },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  setNumber: { width: 40 },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  cardFooter: { alignItems: 'flex-start' },
});
