import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { TABS } from '@/navigation/tabs';

// The tab bar for signed-in users: History, Progress and Templates.
// Other screens (a workout, the log screen, a chart) open on top of this, covering the tab bar.
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
