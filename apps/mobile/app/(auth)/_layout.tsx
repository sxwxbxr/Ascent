import { Stack } from 'expo-router';

/**
 * Eigener Navigator für die (auth)-Gruppe (login/register), analog zu
 * (tabs)/_layout.tsx — nötig, damit das Root-Layout die Gruppe als einen
 * benannten Screen ("(auth)") per Stack.Protected schalten kann.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#131313' },
      }}
    />
  );
}
