import type { TemplateDetail } from '@shared/models';
import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { templateSummary } from '@/workouts/summary';
import { useTemplates } from '@/workouts/use-templates';

// The Templates tab: the user's templates, sorted by name (the server's order, ignoring case).
// Only reachable while signed in.
export default function TemplatesScreen() {
  const router = useRouter();
  const templates = useTemplates();
  // Ignores a second tap on a row or "+ New template" until this screen is shown again.
  const guard = usePressGuard();
  // True only during a pull-to-refresh, as on the history screen.
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await templates.refetch();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.screen}>
      <Tabs.Screen
        options={{
          headerRight: () => (
            <TextButton
              label="+ New template"
              accessibilityLabel="New template"
              onPress={() => guard.navigate(() => router.push('/templates/new'))}
            />
          ),
        }}
      />
      {templates.data === undefined ? (
        templates.isError ? (
          <ErrorState
            error={templates.error}
            retrying={templates.isFetching}
            onRetry={() => void templates.refetch()}
          />
        ) : (
          <LoadingState label="Loading templates" />
        )
      ) : (
        <FlatList
          testID="template-list"
          data={templates.data}
          keyExtractor={(template) => String(template.id)}
          renderItem={({ item }) => (
            <TemplateRow
              template={item}
              onPress={() =>
                guard.navigate(() =>
                  router.push({ pathname: '/templates/[id]', params: { id: String(item.id) } })
                )
              }
            />
          )}
          ItemSeparatorComponent={Separator}
          // Inside the list, so pull-to-refresh works when it's empty too.
          ListEmptyComponent={EmptyState}
          contentContainerStyle={templates.data.length === 0 && styles.emptyContent}
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
        />
      )}
    </ThemedView>
  );
}

function TemplateRow({ template, onPress }: { template: TemplateDetail; onPress: () => void }) {
  const theme = useTheme();
  const summary = templateSummary(template);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // One sentence for screen readers: "Leg day · Squat 3 · RDL 3 · Leg press 4".
      accessibilityLabel={`${template.name} · ${summary}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText>{template.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {summary}
      </ThemedText>
    </Pressable>
  );
}

function Separator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />;
}

function EmptyState() {
  return (
    <MessageState title="No templates yet">
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        Tap + New template to plan a workout you do often. You can also save a workout as a
        template from its screen.
      </ThemedText>
    </MessageState>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyContent: { flexGrow: 1 },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.half },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  hint: { textAlign: 'center' },
});
