import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { Sheet } from '@/components/sheet';
import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { templateSummary } from '@/workouts/summary';
import { useTemplates } from '@/workouts/use-templates';

// A sheet, not an Alert, because Android alerts hold at most three buttons and there can be any
// number of templates.
export default function StartWorkoutSheet() {
  const router = useRouter();
  const theme = useTheme();
  const templates = useTemplates();
  // Shared with the sheet's Cancel, so a double tap opens one log screen and can't also cancel.
  const guard = usePressGuard();

  // replace, not push, so back from the log screen goes to the history, not this chooser.
  function start(templateId?: number) {
    guard.navigate(() =>
      router.replace(
        templateId === undefined
          ? '/workouts/new'
          : { pathname: '/workouts/new', params: { templateId: String(templateId) } }
      )
    );
  }

  return (
    <Sheet title="Log workout" guard={guard}>
      <Button label="Empty workout" onPress={() => start()} />

      <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
        From a template
      </ThemedText>
      {templates.data ? (
        templates.data.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No templates yet. Make one in the Templates tab, or save a workout as one.
          </ThemedText>
        ) : (
          // A View, not a FlatList, since the sheet sizes itself to its content. A long list
          // would need a scrolling sheet.
          <View>
            {templates.data.map((template) => {
              const summary = templateSummary(template);
              return (
                <Pressable
                  key={template.id}
                  onPress={() => start(template.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${template.name} · ${summary}`}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText>{template.name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {summary}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )
      ) : templates.isError ? (
        <View style={styles.error}>
          <ThemedText type="small" themeColor="danger">
            {errorMessage(templates.error)}
          </ThemedText>
          <TextButton label="Try again" onPress={() => void templates.refetch()} />
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Loading templates…
        </ThemedText>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: Spacing.two, gap: Spacing.half, borderRadius: Spacing.two },
  error: { gap: Spacing.two, alignItems: 'flex-start' },
});
