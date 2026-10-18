import type { TemplateDetail } from '@shared/models';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { confirm } from '@/components/dialogs';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { parseRouteId } from '@/workouts/detail';
import { setCountLabel } from '@/workouts/summary';
import { useTemplate, useTemplateMutations } from '@/workouts/use-templates';

// One template: its exercises in order with their set counts, Start workout, Edit and Delete.
// /templates/3 opens this with id '3'. Only reachable while signed in.
export default function TemplateDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const templateId = parseRouteId(id);
  const template = useTemplate(templateId);

  // A 404 isn't retried (query-client.ts), so it arrives as the error straight away.
  const notFound =
    templateId === null || (template.error instanceof ApiError && template.error.status === 404);

  if (notFound) {
    return (
      <ThemedView style={styles.screen}>
        <MessageState title="Template not found">
          <Button
            label="Back to templates"
            variant="secondary"
            onPress={() => router.dismissTo('/templates')}
          />
        </MessageState>
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.screen}>
      {template.data ? (
        <TemplateContent template={template.data} />
      ) : template.isError ? (
        <ErrorState
          error={template.error}
          retrying={template.isFetching}
          onRetry={() => void template.refetch()}
        />
      ) : (
        <LoadingState label="Loading template" />
      )}
    </ThemedView>
  );
}

// A separate component so useTemplateMutations (which needs the id) only runs once there's data.
function TemplateContent({ template }: { template: TemplateDetail }) {
  const router = useRouter();
  const theme = useTheme();
  const { deleteTemplate } = useTemplateMutations(template.id);
  const id = String(template.id);
  // One guard for the screen: Edit, Start workout and Delete can't overlap or run twice.
  const guard = usePressGuard();

  // The log screen, prefilled from this template. push, not replace: back returns here.
  function startWorkout() {
    guard.navigate(() =>
      router.push({ pathname: '/workouts/new', params: { templateId: id } })
    );
  }

  function deleteFlow() {
    void guard.run(async (leave) => {
      const sure = await confirm(
        `Delete ${template.name}?`,
        "Workouts you've logged with it are kept.",
        'Delete'
      );
      if (!sure) {
        return;
      }
      try {
        await deleteTemplate.mutateAsync();
        // To the list, even if this screen was opened from a link with nothing below.
        leave(() => router.dismissTo('/templates'));
      } catch (e: unknown) {
        Alert.alert('Could not delete template', errorMessage(e));
      }
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: template.name,
          headerRight: () => (
            <TextButton
              label="Edit"
              onPress={() =>
                guard.navigate(() =>
                  router.push({ pathname: '/templates/[id]/edit', params: { id } })
                )
              }
            />
          ),
        }}
      />

      <ThemedView type="backgroundElement" style={styles.card}>
        {template.exercises.map((exercise, index) => {
          const sets = setCountLabel(exercise.set_count);
          return (
            <View
              key={exercise.exercise_id}
              // One stop for screen readers ("Squat · 3 sets"); tests read the order from it.
              accessible
              accessibilityLabel={`${exercise.exercise_name} · ${sets}`}
              testID="template exercise"
              style={[
                styles.row,
                index > 0 && { borderTopColor: theme.backgroundSelected, borderTopWidth: StyleSheet.hairlineWidth },
              ]}>
              <ThemedText themeColor="textSecondary" style={styles.number}>
                {index + 1}
              </ThemedText>
              <ThemedText style={styles.exerciseName}>{exercise.exercise_name}</ThemedText>
              <ThemedText themeColor="textSecondary">{sets}</ThemedText>
            </View>
          );
        })}
      </ThemedView>

      <Button label="Start workout" onPress={startWorkout} />

      <View style={styles.footer}>
        <Button
          label="Delete template"
          variant="danger"
          loading={deleteTemplate.isPending}
          onPress={deleteFlow}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Spacing.three, paddingHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  number: { minWidth: 20 },
  exerciseName: { flex: 1 },
  footer: { paddingTop: Spacing.four },
});
