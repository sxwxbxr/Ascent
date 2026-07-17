import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Tier } from "@ascent/shared";
import { api } from "./api";

/** Antwortform von `GET /entitlements` (siehe apps/api/src/index.ts). */
export interface Entitlements {
  tier: Tier;
  features: Record<string, boolean>;
}

interface EntitlementsContextValue {
  entitlements: Entitlements;
  loading: boolean;
  error: string | null;
}

const DEFAULT_ENTITLEMENTS: Entitlements = { tier: "free", features: {} };

const EntitlementsContext = createContext<EntitlementsContextValue | null>(null);

/**
 * Lädt einmal pro App-Session `GET /entitlements` und cacht das Ergebnis im
 * Context. Feature-Gating läuft ausschliesslich über {@link useEntitlement} –
 * NIE über hartcodierte Bedingungen (siehe CLAUDE.md/Lastenheft).
 */
export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const [entitlements, setEntitlements] = useState<Entitlements>(DEFAULT_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await api.get<Entitlements>("/entitlements");
        if (!cancelled) setEntitlements(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Entitlements konnten nicht geladen werden.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<EntitlementsContextValue>(
    () => ({ entitlements, loading, error }),
    [entitlements, loading, error],
  );

  // createElement statt JSX: die Datei bleibt bewusst `.ts` (kein `.tsx`).
  return createElement(EntitlementsContext.Provider, { value }, children);
}

function useEntitlementsContext(): EntitlementsContextValue {
  const context = useContext(EntitlementsContext);
  if (!context) {
    throw new Error("useEntitlement()/useEntitlements() muss innerhalb von <EntitlementsProvider> aufgerufen werden.");
  }
  return context;
}

/**
 * Prüft EIN Feature-Flag gegen die geladenen Entitlements. Liefert `false`,
 * solange die Antwort noch lädt (sicherer Default: Feature versteckt statt
 * kurz "unlocked" aufzublitzen).
 */
export function useEntitlement(key: string): boolean {
  const { entitlements, loading } = useEntitlementsContext();
  if (loading) return false;
  return entitlements.features[key] ?? false;
}

/** Für Seiten, die zusätzlich den Tarif selbst oder den Ladezustand brauchen (z. B. Einstellungen). */
export function useEntitlements(): EntitlementsContextValue {
  return useEntitlementsContext();
}
