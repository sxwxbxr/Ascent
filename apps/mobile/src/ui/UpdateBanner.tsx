import { useEffect, useState } from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { API_URL } from '../config';

/** Vergleicht zwei Versionsstrings "x.y.z"; >0 wenn a neuer als b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

type VersionInfo = { latestVersion?: string; apkUrl?: string | null };

/**
 * Update-Hinweis (Lastenheft 4.11): fragt beim Start /version ab und blendet
 * einen Banner ein, wenn die installierte App älter als die neueste Version
 * ist. Tippen öffnet die Download-Seite der Web-App. Rein informativ,
 * blockiert nie — schlägt der Abruf fehl (offline), erscheint kein Banner.
 */
export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const insets = useSafeAreaInsets();

  const current = Constants.expoConfig?.version ?? '0.0.0';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/version`);
        if (!res.ok) return;
        const info = (await res.json()) as VersionInfo;
        if (!cancelled && info.latestVersion && compareVersions(info.latestVersion, current) > 0) {
          setUpdateAvailable(true);
        }
      } catch {
        // Offline oder Server nicht erreichbar — kein Banner, kein Fehler.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current]);

  if (!updateAvailable || dismissed) return null;

  return (
    <Pressable
      onPress={() => void Linking.openURL(`${API_URL}/download`)}
      android_ripple={{ color: 'rgba(0,0,0,0.15)' }}
      style={{ paddingTop: insets.top + 12 }}
      className="flex-row items-center justify-between gap-3 bg-primary px-4 pb-3 active:opacity-90"
    >
      <Text className="flex-1 font-sans text-sm font-bold text-on-primary">
        Neue Version verfügbar — zum Aktualisieren tippen
      </Text>
      <Pressable hitSlop={12} onPress={() => setDismissed(true)}>
        <Text className="font-sans text-sm font-bold text-on-primary">✕</Text>
      </Pressable>
    </Pressable>
  );
}
