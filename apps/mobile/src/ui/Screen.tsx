import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Einheitlicher Screen-Rahmen für alle Tab-/Vollbild-Screens OHNE nativen
 * Stack-Header: schiebt den Inhalt unter der OS-Statusleiste heraus
 * (SafeArea-Top-Inset — der Beta-Test zeigte überlappende Titel!) und
 * liefert die konsistente Titelzeile aus dem Design-System.
 *
 * scroll=false für Screens, die selbst eine FlatList/ScrollView verwalten.
 */
export function Screen({
  title,
  subtitle,
  headerRight,
  scroll = true,
  children,
}: {
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  const header =
    title !== undefined ? (
      <View className="flex-row items-start justify-between px-4 pb-2 pt-3">
        <View className="flex-1 pr-3">
          <Text className="font-sans text-3xl font-extrabold text-on-surface">{title}</Text>
          {subtitle ? (
            <Text className="mt-0.5 font-sans text-base text-on-surface-muted">{subtitle}</Text>
          ) : null}
        </View>
        {headerRight ? <View className="pt-1">{headerRight}</View> : null}
      </View>
    ) : null;

  if (!scroll) {
    return (
      <View className="flex-1 bg-surface" style={{ paddingTop: insets.top }}>
        {header}
        {children}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface" style={{ paddingTop: insets.top }}>
      {header}
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 gap-6"
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  );
}
