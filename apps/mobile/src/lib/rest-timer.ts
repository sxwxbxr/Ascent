import { useCallback, useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';

/**
 * Pausentimer für das aktive Training. Zustand lebt auf Modulebene (nicht in
 * React-State), damit der Timer einen Screen-Wechsel oder Remount der
 * aufrufenden Komponente übersteht — die Komponente liest via `useRestTimer()`
 * nur den aktuellen Stand und abonniert Änderungen.
 *
 * SDK-57-APIs verifiziert gegen node_modules/expo-notifications/build/*.d.ts:
 * - setNotificationHandler(handler): NotificationsHandler.d.ts — Handler muss
 *   `shouldShowBanner`/`shouldShowList` liefern (shouldShowAlert ist deprecated).
 * - requestPermissionsAsync()/getPermissionsAsync(): NotificationPermissions.d.ts,
 *   Rückgabe ist PermissionResponse (Feld `granted: boolean`).
 * - scheduleNotificationAsync({ content, trigger }): scheduleNotificationAsync.d.ts;
 *   Trigger-Typ für "in X Sekunden": Notifications.types.d.ts →
 *   `{ type: SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: false }`.
 * - cancelScheduledNotificationAsync(identifier): cancelScheduledNotificationAsync.d.ts.
 */

const REST_NOTIFICATION_TITLE = 'Ascent';
const REST_NOTIFICATION_BODY = "Pause vorbei — weiter geht's! 💪";

// Banner auch im Vordergrund zeigen (SDK-57-Ersatz für das alte shouldShowAlert).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let endAt: number | null = null;
let totalSeconds = 0;
let scheduledNotificationId: string | null = null;
let permissionRequested = false;
let tickInterval: ReturnType<typeof setInterval> | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function computeRemaining(): number {
  if (endAt === null) {
    return 0;
  }
  return Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
}

function stopTicking(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function ensureTicking(): void {
  if (tickInterval !== null) {
    return;
  }
  tickInterval = setInterval(() => {
    if (endAt === null || computeRemaining() <= 0) {
      endAt = null;
      stopTicking();
      notifyListeners();
      return;
    }
    notifyListeners();
  }, 1000);
}

/** Fordert Benachrichtigungs-Rechte einmalig pro App-Sitzung an. */
async function ensurePermissionGranted(): Promise<boolean> {
  if (!permissionRequested) {
    permissionRequested = true;
    try {
      const result = await Notifications.requestPermissionsAsync();
      return result.granted;
    } catch {
      return false;
    }
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    return current.granted;
  } catch {
    return false;
  }
}

async function cancelScheduledNotification(): Promise<void> {
  const id = scheduledNotificationId;
  if (id === null) {
    return;
  }
  scheduledNotificationId = null;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Bereits gefeuert/abgelaufen — kann ignoriert werden.
  }
}

async function startRestTimer(seconds: number): Promise<void> {
  await cancelScheduledNotification();

  totalSeconds = seconds;
  endAt = Date.now() + seconds * 1000;
  ensureTicking();
  notifyListeners();

  const granted = await ensurePermissionGranted();
  if (!granted) {
    // Ohne Permission stillschweigend nur In-App-Countdown (kein Fehler-UI).
    return;
  }

  try {
    scheduledNotificationId = await Notifications.scheduleNotificationAsync({
      content: { title: REST_NOTIFICATION_TITLE, body: REST_NOTIFICATION_BODY },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
  } catch {
    scheduledNotificationId = null;
  }
}

async function skipRestTimer(): Promise<void> {
  endAt = null;
  stopTicking();
  notifyListeners();
  await cancelScheduledNotification();
}

export interface RestTimerState {
  /** Verbleibende Sekunden (0, wenn kein Timer läuft). */
  remainingSeconds: number;
  /** Gesamtdauer des zuletzt gestarteten Timers (für Fortschrittsbalken). */
  totalSeconds: number;
  isRunning: boolean;
  /** Startet (oder ersetzt) den Pausentimer; bricht einen laufenden Timer ab. */
  start: (seconds: number) => void;
  /** Überspringt die Pause und storniert die geplante Notification. */
  skip: () => void;
}

/** Reaktiver Zugriff auf den modul-globalen Pausentimer. */
export function useRestTimer(): RestTimerState {
  const [remainingSeconds, setRemainingSeconds] = useState(computeRemaining);

  useEffect(() => {
    const listener = (): void => setRemainingSeconds(computeRemaining());
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const start = useCallback((seconds: number) => {
    void startRestTimer(seconds);
  }, []);

  const skip = useCallback(() => {
    void skipRestTimer();
  }, []);

  return { remainingSeconds, totalSeconds, isRunning: remainingSeconds > 0, start, skip };
}
