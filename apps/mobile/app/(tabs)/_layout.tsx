import { Tabs } from 'expo-router';

/**
 * Tab-Layout: Home, Pläne, Verlauf, Profil.
 *
 * Icons: @expo/vector-icons ist in diesem Projekt nicht installiert (weder
 * unter node_modules noch in pnpm-lock.yaml geprüft) — statt einer
 * ungeprüften Bibliotheks-Annahme daher bewusst ein sauberer Text-Fallback
 * (Label + Farbzustand für aktiv/inaktiv), keine Icons.
 *
 * SafeArea: kein manuelles SafeAreaView nötig — expo-router umschliesst die
 * gesamte App bereits mit <SafeAreaProvider> (node_modules/expo-router/
 * build/ExpoRoot.js), und React Navigations Standard-Tabbar respektiert den
 * unteren Inset (Gestennavigation) automatisch, solange `tabBarStyle` keine
 * feste `height` erzwingt (hier bewusst nicht gesetzt).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#1e1e1e', borderTopColor: '#2c2c2c', borderTopWidth: 1 },
        tabBarActiveTintColor: '#b4ff39',
        tabBarInactiveTintColor: '#a0a0a0',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="plans" options={{ title: 'Pläne' }} />
      <Tabs.Screen name="verlauf" options={{ title: 'Verlauf' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
