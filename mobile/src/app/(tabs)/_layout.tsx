import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { TABS } from '@/navigation/tabs';

// The signed-in home: a tab bar with History, Progress and Templates. JS tabs (not native tabs,
// which are still unstable in SDK 57 and have no header of their own): each tab gets a header
// with its title, and its screen adds header buttons through <Stack.Screen options> as before.
// Other signed-in screens (a workout, the log screen, a progress chart) are in the root Stack,
// so they open over this whole layout, tab bar included.
export default function TabsLayout() {
  return (
    <Tabs>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarLabel: tab.label,
            // The tab bar passes the color for the tab's state (active or not) and the icon size.
            tabBarIcon: ({ color, size }) => <SymbolView name={tab.icon} tintColor={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
