// Shared with the root Stack, which names the tabs screen after the focused tab for the back
// button. Not in src/app/, where every file becomes a route.
import type { SymbolViewProps } from 'expo-symbols';

export interface Tab {
  // The route file in src/app/(tabs)/, without .tsx.
  name: string;
  // The screen's header title, also the iOS back button's label on screens opened from this tab.
  title: string;
  // The label under the icon in the tab bar.
  label: string;
  // SF Symbol on iOS, Material Symbol on Android (expo-symbols checks both names' types).
  icon: SymbolViewProps['name'];
}

export const TABS: readonly Tab[] = [
  {
    name: 'index',
    title: 'Workouts',
    label: 'History',
    icon: { ios: 'clock.arrow.circlepath', android: 'history' },
  },
  {
    name: 'progress',
    title: 'Progress',
    label: 'Progress',
    icon: { ios: 'chart.line.uptrend.xyaxis', android: 'show_chart' },
  },
  {
    name: 'templates',
    title: 'Templates',
    label: 'Templates',
    icon: { ios: 'list.bullet.clipboard', android: 'content_paste' },
  },
];

// The title of the tab with this route name. Before any tab has been focused there's no name yet,
// and the first tab is the one shown.
export function tabTitle(routeName: string | undefined): string {
  const tab = TABS.find((t) => t.name === routeName) ?? TABS[0];
  // TABS[0] is `Tab | undefined` under noUncheckedIndexedAccess, though the list is never empty.
  return tab?.title ?? '';
}
