import type { ExerciseLastSets, TemplateDetail } from '@shared/models';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiError } from '@/api/client';
import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { DateField } from '@/components/date-field';
import { confirm } from '@/components/dialogs';
import { ExercisePicker } from '@/components/exercise-picker';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UnitPicker } from '@/components/unit-picker';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { localDateString } from '@/workouts/dates';
import { parseRouteId } from '@/workouts/detail';
import {
  createLogForm,
  createLogFormFromTemplate,
  hasChanges,
  logFormReducer,
  validateLogForm,
  type LogAction,
  type LogExercise,
  type LogForm,
  type LogSet,
  type SetErrors,
} from '@/workouts/log-form';
import { useFetchLastSets, useLastSets, useTemplate } from '@/workouts/use-templates';
import { useCreateWorkout } from '@/workouts/use-workouts';

// Log a new workout: date, notes, and exercises with their sets, saved in one POST /workouts.
// Two ways in:
// - "Empty workout" (from History's "+ Log workout"): no exercises yet.
// - A template (/workouts/new?templateId=1, from "Start workout" or the same chooser): its
//   exercises and set counts, each row hinted with last time's numbers.
// Only reachable while signed in.
export default function LogWorkoutScreen() {
  // A query param, like a path param: a string, a string[] if repeated, or undefined.
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  // "Today" on the phone's calendar, fixed when the screen opens. useState's initializer runs once.
  const [today] = useState(() => localDateString());

  if (templateId === undefined) {
    return <LogWorkoutForm initial={createLogForm(today)} />;
  }
  return <FromTemplate templateId={parseRouteId(templateId)} today={today} />;
}

// Loads the template, then last time's sets for its exercises, and only then shows the form:
// the hints are part of its starting state, so they never change under the user's thumb.
function FromTemplate({ templateId, today }: { templateId: number | null; today: string }) {
  const router = useRouter();
  const template = useTemplate(templateId);
  const lastSets = useLastSets(template.data?.exercises.map((e) => e.exercise_id) ?? []);

  const notFound =
    templateId === null || (template.error instanceof ApiError && template.error.status === 404);

  if (notFound) {
    return (
      <ThemedView style={styles.screen}>
        <MessageState title="Template not found">
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </MessageState>
      </ThemedView>
    );
  }
  // isFetchedAfterMount: last sets may already be cached from an earlier visit, but a workout
  // logged since then changes them, so wait for this screen's own fetch. It stays true through
  // later background refetches, so the form isn't swapped out once shown.
  if (template.data && lastSets.data && lastSets.isFetchedAfterMount) {
    return <TemplateForm template={template.data} lastSets={lastSets.data} today={today} />;
  }
  const failed = template.isError ? template : lastSets.isError ? lastSets : null;
  return (
    <ThemedView style={styles.screen}>
      {failed ? (
        <ErrorState
          error={failed.error}
          retrying={failed.isFetching}
          onRetry={() => void failed.refetch()}
        />
      ) : (
        <LoadingState label="Loading workout" />
      )}
    </ThemedView>
  );
}

// Its own component so the starting form is built once, from the data as it was when it arrived.
function TemplateForm({
  template,
  lastSets,
  today,
}: {
  template: TemplateDetail;
  lastSets: ExerciseLastSets[];
  today: string;
}) {
  const [initial] = useState(() => createLogFormFromTemplate(today, template, lastSets));
  return <LogWorkoutForm initial={initial} title={template.name} />;
}

function LogWorkoutForm({ initial: firstForm, title }: { initial: LogForm; title?: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  // The starting form, kept so hasChanges can compare against it (leaving a template workout
  // untouched asks nothing). useReducer only reads its second argument on the first render;
  // dispatch(action) then runs the reducer (src/workouts/log-form.ts) and re-renders.
  const [initial] = useState(firstForm);
  const [form, dispatch] = useReducer(logFormReducer, initial);
  // True after the first press of Save: from then on, empty fields show their errors too.
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const createWorkout = useCreateWorkout();
  const fetchLastSets = useFetchLastSets();
  const guard = usePressGuard();
  // Set just before leaving after a save, so the discard check below lets that navigation through.
  // A ref, not state: it must be readable in the same moment, before any re-render.
  const saved = useRef(false);

  const validation = validateLogForm(form);

  // Runs whenever this screen is about to be removed while `preventRemove` is true: the back
  // button, the iOS swipe, Android's back key, or router.replace after saving. The removal is
  // put on hold; navigation.dispatch(data.action) lets it continue.
  usePreventRemove(hasChanges(form, initial), ({ data }) => {
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
      {/* The template's name as the title ("Leg day"); otherwise the root layout's "Log workout". */}
      {title ? <Stack.Screen options={{ title }} /> : null}
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

        {/* Always enabled: pressing it with nothing ticked says why nothing can be saved, and
            with a ticked set still invalid shows that set's errors (see validateLogForm). */}
        {submitted && validation.setsError ? <FieldError message={validation.setsError} /> : null}
        {saveError ? <FieldError message={saveError} /> : null}
        <Button label="Save workout" loading={createWorkout.isPending} onPress={save} />
      </ScrollView>

      <ExercisePicker
        visible={pickerOpen}
        excludeIds={form.exercises.map((e) => e.exerciseId)}
        onClose={() => setPickerOpen(false)}
        onPick={(exercise) => {
          // The card appears straight away, loading; its rows follow once last time is known.
          dispatch({ type: 'addExercise', exercise, loading: true });
          setPickerOpen(false);
          // A failed request counts as never logged (one empty row): hints are only a prefill,
          // and the user can still log the exercise.
          void fetchLastSets(exercise.id)
            .catch(() => null)
            .then((lastSets) => dispatch({ type: 'fillLastSets', exerciseId: exercise.id, lastSets }));
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
          onToggle={() => dispatch({ type: 'toggleSet', exerciseKey, setKey: set.key })}
        />
      ))}

      {exercise.loading ? (
        // Until last time's sets arrive: no rows yet, so none can change under the user's thumb.
        <ActivityIndicator style={styles.cardLoading} accessibilityLabel={`Loading last time for ${name}`} />
      ) : (
        <View style={styles.cardFooter}>
          <TextButton
            label="+ Add set"
            accessibilityLabel={`Add ${name} set`}
            onPress={() => dispatch({ type: 'addSet', exerciseKey })}
          />
        </View>
      )}
    </ThemedView>
  );
}

interface SetRowProps {
  label: string;
  number: number;
  set: LogSet;
  errors: SetErrors;
  onChange: (change: Partial<Pick<LogSet, 'reps' | 'weight' | 'unit'>>) => void;
  onRemove: () => void;
  onToggle: () => void;
}

function SetRow({ label, number, set, errors, onChange, onRemove, onToggle }: SetRowProps) {
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
        {/* The ✓: only ticked sets are saved. It shows the set's number until ticked, which
            keeps the row narrow enough for a phone. A "checkbox" role with a checked state is
            what screen readers announce ("Squat set 1 done, checkbox, checked"). */}
        <Pressable
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityLabel={`${label} done`}
          accessibilityState={{ checked: set.ticked }}
          hitSlop={Spacing.two}
          style={[
            styles.check,
            set.ticked
              ? { backgroundColor: theme.text, borderColor: theme.text }
              : { borderColor: theme.textSecondary },
          ]}>
          <Text style={[styles.checkLabel, { color: set.ticked ? theme.background : theme.textSecondary }]}>
            {set.ticked ? '✓' : number}
          </Text>
        </Pressable>
        <TextInput
          accessibilityLabel={`${label} reps`}
          // Last time's numbers, greyed out; a field left blank is saved with them when ticked.
          placeholder={set.hint?.reps ?? 'Reps'}
          placeholderTextColor={theme.textSecondary}
          value={set.reps}
          onChangeText={(reps) => onChange({ reps })}
          keyboardType="number-pad"
          style={inputStyle(errors.reps)}
        />
        <TextInput
          accessibilityLabel={`${label} weight`}
          placeholder={set.hint?.weight ?? 'Weight'}
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
  check: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: { fontSize: 14, fontWeight: '600' },
  input: {
    flex: 1,
    minWidth: 0,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  cardFooter: { alignItems: 'flex-start' },
  cardLoading: { alignSelf: 'flex-start', paddingVertical: Spacing.two },
});
