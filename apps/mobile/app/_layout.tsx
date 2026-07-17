import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Platzhalter-Root-Layout (M3-Fundament). Der Auth-Gate-Ausbau
// (Session-Check, Migrationslauf, Redirect auf /login) folgt im
// M3-Auth-Arbeitspaket.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#131313' },
        }}
      />
    </>
  );
}
