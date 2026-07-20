import { useEffect, useRef } from "react";

/** Optionen für {@link useVisiblePolling}. */
interface VisiblePollingOptions {
  /** Intervall zwischen zwei Polls in ms (wirkt nur, solange der Tab sichtbar ist). */
  intervalMs: number;
  /** Minimaler Abstand zwischen zwei tatsächlichen `callback`-Aufrufen (Debounce). */
  minGapMs: number;
  /** Solange `false`: kein Intervall, keine Listener (z. B. nach 401 – Session weg). */
  enabled: boolean;
}

/**
 * Pollt `callback`, solange der Browser-Tab sichtbar ist – Grundlage für das
 * Live-Update des Web-Dashboards (siehe snapshot.ts): die Mobile-App pusht
 * nach jeder Änderung automatisch (queueSyncPush, ~4s Verzögerung), das
 * Dashboard soll diese Änderungen ohne F5 übernehmen.
 *
 * Drei Auslöser, ein gemeinsamer Debounce (`minGapMs`, verhindert z. B.
 * Doppel-Polls, wenn `focus` und `visibilitychange` fast gleichzeitig feuern):
 * - Intervall alle `intervalMs`, übersprungen wenn `document.visibilityState !== "visible"`.
 * - sofort bei Rückkehr zur Sichtbarkeit (`visibilitychange` → visible).
 * - sofort bei `window`-`focus`.
 */
export function useVisiblePolling(callback: () => void, options: VisiblePollingOptions): void {
  const { intervalMs, minGapMs, enabled } = options;
  // Ref statt direkter Closure, damit sich das Intervall/die Listener bei
  // jedem Render von `callback` NICHT neu aufbauen müssen.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const lastRunRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function runIfDue(): void {
      const now = Date.now();
      if (now - lastRunRef.current < minGapMs) {
        return;
      }
      lastRunRef.current = now;
      callbackRef.current();
    }

    function onIntervalTick(): void {
      if (document.visibilityState === "visible") {
        runIfDue();
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        runIfDue();
      }
    }

    const intervalId = setInterval(onIntervalTick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", runIfDue);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", runIfDue);
    };
  }, [intervalMs, minGapMs, enabled]);
}
