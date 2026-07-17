import * as Crypto from 'expo-crypto';

/**
 * Client-generierte UUID (Sync-Konvention: text-PKs, offline erzeugbar).
 * Hermes hat kein natives crypto.randomUUID — daher expo-crypto.
 */
export function newId(): string {
  return Crypto.randomUUID();
}
