import type { TemplateDetail } from '@shared/models';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ApiError } from '@/api/client';
import { Button } from '@/components/button';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TemplateEditor } from '@/components/template-editor';
import { ThemedView } from '@/components/themed-view';
import { parseRouteId } from '@/workouts/detail';
import { templateFormFrom } from '@/workouts/template-form';
import { useTemplate, useTemplateMutations } from '@/workouts/use-templates';

// Edit from a template's detail: the same form as "+ New template", starting from the saved
// template, saved with PUT /templates/:id. Only reachable while signed in.
export default function EditTemplateScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const templateId = parseRouteId(id);
  // Usually already cached by the detail screen, so the form shows straight away.
  const template = useTemplate(templateId);

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
  if (template.data) {
    return <EditForm template={template.data} />;
  }
  return (
    <ThemedView style={styles.screen}>
      {template.isError ? (
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

// A separate component so its hooks only run once the template has loaded (as in
// workouts/[id]/index.tsx): the form's starting state is built from it.
function EditForm({ template }: { template: TemplateDetail }) {
  const router = useRouter();
  const { updateTemplate } = useTemplateMutations(template.id);
  const [initial] = useState(() => templateFormFrom(template));

  return (
    <TemplateEditor
      initial={initial}
      save={(body) => updateTemplate.mutateAsync(body)}
      saving={updateTemplate.isPending}
      // Back to the detail, which shows the saved template from the cache.
      onSaved={() => router.back()}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
