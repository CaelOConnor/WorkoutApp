import type { TemplateBody, TemplateDetail } from '@shared/models';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useReducer, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { confirm } from '@/components/dialogs';
import { ExercisePicker } from '@/components/exercise-picker';
import { TextButton } from '@/components/text-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { setCountLabel } from '@/workouts/summary';
import {
  MAX_SET_COUNT,
  MIN_SET_COUNT,
  templateFormChanged,
  templateFormReducer,
  validateTemplateForm,
  type TemplateAction,
  type TemplateForm,
  type TemplateFormExercise,
} from '@/workouts/template-form';

export interface TemplateEditorProps {
  initial: TemplateForm;
  // A rejection, like the 409 for a name in use, is shown above the Save button.
  save: (body: TemplateBody) => Promise<TemplateDetail>;
  saving: boolean;
  onSaved: (template: TemplateDetail) => void;
  // A note above the exercises, e.g. that set counts from a workout were capped.
  notice?: string | null;
}

// Shared by New template and Edit. The rules live in the reducer in workouts/template-form.ts.
export function TemplateEditor({ initial, save, saving, onSaved, notice }: TemplateEditorProps) {
  const navigation = useNavigation();
  // useReducer's second argument is only read on the first render, so a refetch of the template
  // while the form is open doesn't overwrite what the user is typing.
  const [form, dispatch] = useReducer(templateFormReducer, initial);
  // Kept to tell whether anything changed, for the discard prompt.
  const [start] = useState(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const guard = usePressGuard();
  // Set just before leaving after a save, so the discard check lets it through. A ref, since
  // state wouldn't update until the next render.
  const saved = useRef(false);

  const validation = validateTemplateForm(form);

  // The server's error was about what was sent, so any change clears it.
  function update(action: TemplateAction) {
    setSaveError(null);
    dispatch(action);
  }

  // Holds any way of leaving while there are unsaved changes, until the user answers.
  usePreventRemove(templateFormChanged(form, start), ({ data }) => {
    if (saved.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirm(
      'Discard changes?',
      'Your changes to this template will be lost.',
      'Discard',
      'Keep editing'
    ).then((discard) => {
      if (discard) {
        navigation.dispatch(data.action);
      }
    });
  });

  function handleSave() {
    // Through the guard, so a double tap sends one request and the form stays locked as it leaves.
    void guard.run(async (leave) => {
      const { body } = validateTemplateForm(form);
      if (!body) {
        return;
      }
      setSaveError(null);
      try {
        const template = await save(body);
        saved.current = true;
        leave(() => onSaved(template));
      } catch (e: unknown) {
        setSaveError(errorMessage(e));
      }
    });
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <TextField
          label="Template name"
          placeholder="e.g. Leg day"
          value={form.name}
          onChangeText={(name) => update({ type: 'setName', name })}
          autoCapitalize="sentences"
          returnKeyType="done"
        />
        {/* A blank name only disables Save; a name that's too long says why. */}
        {form.name.trim() !== '' && validation.nameError ? (
          <FieldError message={validation.nameError} />
        ) : null}

        {notice ? <ThemedText type="small" themeColor="textSecondary">{notice}</ThemedText> : null}

        {validation.exercisesError ? (
          <ThemedText themeColor="textSecondary">{validation.exercisesError}</ThemedText>
        ) : null}

        {form.exercises.map((exercise, index) => (
          <ExerciseRow
            key={exercise.key}
            exercise={exercise}
            first={index === 0}
            last={index === form.exercises.length - 1}
            dispatch={update}
          />
        ))}

        <Button
          label="+ Add exercise"
          accessibilityLabel="Add exercise"
          variant="secondary"
          onPress={() => setPickerOpen(true)}
        />

        {saveError ? (
          // The alert role makes screen readers announce it at once, and tests find it by role.
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {saveError}
          </ThemedText>
        ) : null}
        <Button
          label="Save template"
          disabled={validation.body === null}
          loading={saving}
          onPress={handleSave}
        />
      </ScrollView>

      <ExercisePicker
        visible={pickerOpen}
        excludeIds={form.exercises.map((e) => e.exerciseId)}
        onClose={() => setPickerOpen(false)}
        onPick={(exercise) => {
          update({ type: 'addExercise', exercise });
          setPickerOpen(false);
        }}
      />
    </ThemedView>
  );
}

interface ExerciseRowProps {
  exercise: TemplateFormExercise;
  // At the top or bottom of the list: that move button is disabled.
  first: boolean;
  last: boolean;
  dispatch: (action: TemplateAction) => void;
}

function ExerciseRow({ exercise, first, last, dispatch }: ExerciseRowProps) {
  const { key: exerciseKey, name, setCount } = exercise;

  return (
    <ThemedView type="backgroundElement" style={styles.card} testID={`${name} card`}>
      <View style={styles.cardHeader}>
        <ThemedText type="smallBold" style={styles.exerciseName}>
          {name}
        </ThemedText>
        <TextButton
          label="↑"
          accessibilityLabel={`Move ${name} up`}
          disabled={first}
          onPress={() => dispatch({ type: 'moveExercise', exerciseKey, direction: 'up' })}
        />
        <TextButton
          label="↓"
          accessibilityLabel={`Move ${name} down`}
          disabled={last}
          onPress={() => dispatch({ type: 'moveExercise', exerciseKey, direction: 'down' })}
        />
      </View>

      <View style={styles.cardFooter}>
        {/* Disabled at the server's set count limits. */}
        <View style={styles.stepper}>
          <TextButton
            label="−"
            accessibilityLabel={`Fewer ${name} sets`}
            disabled={setCount <= MIN_SET_COUNT}
            onPress={() => dispatch({ type: 'changeSetCount', exerciseKey, by: -1 })}
          />
          <ThemedText style={styles.setCount}>{setCountLabel(setCount)}</ThemedText>
          <TextButton
            label="+"
            accessibilityLabel={`More ${name} sets`}
            disabled={setCount >= MAX_SET_COUNT}
            onPress={() => dispatch({ type: 'changeSetCount', exerciseKey, by: 1 })}
          />
        </View>
        <TextButton
          label="Remove"
          accessibilityLabel={`Remove ${name}`}
          color="danger"
          onPress={() => dispatch({ type: 'removeExercise', exerciseKey })}
        />
      </View>
    </ThemedView>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  exerciseName: { fontSize: 16, flex: 1 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  setCount: { minWidth: 64, textAlign: 'center' },
});
