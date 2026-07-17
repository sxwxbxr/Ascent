import { Stack } from 'expo-router';

/**
 * Eigener Stack für die Übungsdatenbank (Auswahl/Detail/Neu) ausserhalb der
 * Tab-Navigation — Titel werden pro Screen dynamisch gesetzt (siehe
 * index.tsx: "Übung wählen" vs. "Übungen", [id].tsx: Übungsname).
 */
export default function ExercisesLayout() {
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
