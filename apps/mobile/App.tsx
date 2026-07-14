import './global.css';

import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <StatusBar style="light" />
      <View className="flex-1 justify-center px-4">
        <View className="mb-8 items-center">
          <Text className="text-4xl font-extrabold tracking-wide text-white">
            ASCENT
          </Text>
          <Text className="mt-2 text-center text-base text-on-surface-muted">
            Dein Training. Dein Fortschritt.
          </Text>
        </View>

        <View className="gap-4">
          <View className="gap-2">
            <Text className="text-sm font-semibold text-on-surface">
              E-Mail
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="name@beispiel.ch"
              placeholderTextColor="#a0a0a0"
              className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
            />
          </View>

          <View className="gap-2">
            <Text className="text-sm font-semibold text-on-surface">
              Passwort
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="Dein Passwort"
              placeholderTextColor="#a0a0a0"
              className="h-12 rounded-lg bg-surface-container px-3 text-base text-on-surface"
            />
          </View>

          <TouchableOpacity
            onPress={() => {
              // Auth kommt in M1
            }}
            activeOpacity={0.85}
            className="mt-3 h-14 items-center justify-center rounded-lg bg-primary"
          >
            <Text className="text-base font-bold text-on-primary">
              Anmelden
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
