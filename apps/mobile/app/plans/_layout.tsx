import { Stack } from 'expo-router';

/**
 * Eigener Stack für die Plan-Bearbeitung ausserhalb der Tab-Navigation
 * (Design zeigt hier keine BottomNavBar). Header wird — anders als die
 * Tab-Screens — nativ angezeigt (Zurück-Pfeil kommt automatisch von
 * @react-navigation/native-stack).
 */
export default function PlansLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#131313' },
        headerTintColor: '#b4ff39',
        headerTitleStyle: { color: '#e5e2e1', fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#131313' },
      }}
    />
  );
}
