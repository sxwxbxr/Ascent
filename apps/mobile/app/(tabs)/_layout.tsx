import { Tabs } from 'expo-router';

// Platzhalter-Tab-Layout (M3-Fundament): Home, Pläne, Verlauf, Profil.
// Styling/Icons folgen im M3-Auth-Arbeitspaket.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#1e1e1e', borderTopColor: '#2c2c2c' },
        tabBarActiveTintColor: '#b4ff39',
        tabBarInactiveTintColor: '#a0a0a0',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="plans" options={{ title: 'Pläne' }} />
      <Tabs.Screen name="verlauf" options={{ title: 'Verlauf' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
