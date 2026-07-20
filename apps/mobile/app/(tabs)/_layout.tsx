import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

/**
 * Tab-Layout: Home, Pläne, Verlauf, Profil — mit echten Ionicons
 * (der Beta-Test zeigte kaputte Platzhalter-Glyphen ohne Icon-Font).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#1e1e1e', borderTopColor: '#2c2c2c', borderTopWidth: 1 },
        tabBarActiveTintColor: '#b4ff39',
        tabBarInactiveTintColor: '#a0a0a0',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600', fontFamily: 'Inter' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Pläne',
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="verlauf"
        options={{
          title: 'Verlauf',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
