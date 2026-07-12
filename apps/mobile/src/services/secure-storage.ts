// secure-storage.ts — Boucle 2 F4 · S8 (finding sécurité MAJOR du panel)
// Chiffrement au repos des stores MMKV portant des PII (téléphone, UEMOA) :
// clé 256 bits générée par aléa cryptographique (expo-crypto), conservée dans
// le trousseau système via expo-secure-store, MMKV ouvert avec encryptionKey.
//
// Contrainte : SecureStore est async, l'ouverture MMKV est synchrone.
// → initSecureStorage() DOIT être awaitée avant tout accès aux stores
//   (gate posée dans app/_layout.tsx). Les getters lèvent une erreur explicite
//   si le gate n'est pas passé — on échoue FERMÉ, jamais en clair.
//
// Migration (stade dev, décision documentée) : à la PREMIÈRE init (clé absente
// du trousseau), les stores existants sont soit vierges soit hérités en CLAIR ;
// ils sont ouverts sans clé puis chiffrés EN PLACE via recrypt(clé) — la file
// offline MOB-002 existante est préservée, rien n'est purgé.
// Le store 'sigfa-ticket-history' (MOB-005) ne porte pas de téléphone : hors
// périmètre S8, consigné comme couture.
import { MMKV } from 'react-native-mmkv';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/** Nom de l'entrée trousseau qui porte la clé de chiffrement MMKV. */
export const MMKV_ENCRYPTION_KEY_NAME = 'sigfa.mmkv.encryption-key';
/** Store MMKV de la file offline (PII : téléphone) — MOB-002. */
export const OFFLINE_QUEUE_STORE_ID = 'sigfa-offline-queue';
/** Store MMKV de l'état du ticket vivant — MOB-004. */
export const TICKET_STATE_STORE_ID = 'sigfa-ticket-state';

let offlineQueueStorage: MMKV | null = null;
let ticketStateStorage: MMKV | null = null;
let initPromise: Promise<void> | null = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

interface EncryptionKeyResult {
  key: string;
  /** true = clé créée à l'instant (première ouverture → migration recrypt). */
  created: boolean;
}

async function getOrCreateEncryptionKey(): Promise<EncryptionKeyResult> {
  const existing = await SecureStore.getItemAsync(MMKV_ENCRYPTION_KEY_NAME);
  if (existing) {
    return { key: existing, created: false };
  }
  // Aléa cryptographique : 32 octets → clé hex 256 bits
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = toHex(bytes);
  await SecureStore.setItemAsync(MMKV_ENCRYPTION_KEY_NAME, key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
  return { key, created: true };
}

function openEncryptedStore(id: string, key: string, migrate: boolean): MMKV {
  if (migrate) {
    // Première ouverture avec S8 : le store est vierge ou hérité en CLAIR.
    // Ouverture sans clé puis chiffrement en place — préserve MOB-002.
    const store = new MMKV({ id });
    store.recrypt(key);
    return store;
  }
  return new MMKV({ id, encryptionKey: key });
}

/**
 * Initialise les stores MMKV chiffrés (gate S8).
 * Idempotente et sûre en cas d'appels concurrents (promesse mémoïsée).
 * À awaiter au boot (app/_layout.tsx) AVANT tout accès MMKV.
 */
export async function initSecureStorage(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const { key, created } = await getOrCreateEncryptionKey();
      offlineQueueStorage = openEncryptedStore(OFFLINE_QUEUE_STORE_ID, key, created);
      ticketStateStorage = openEncryptedStore(TICKET_STATE_STORE_ID, key, created);
    })();
  }
  try {
    await initPromise;
  } catch (error) {
    // Échec d'init (trousseau indisponible…) : on autorise un retry propre.
    initPromise = null;
    throw error;
  }
}

/** true quand le gate S8 est passé (stores chiffrés ouverts). */
export function isSecureStorageReady(): boolean {
  return offlineQueueStorage !== null && ticketStateStorage !== null;
}

function assertReady(store: MMKV | null): MMKV {
  if (!store) {
    throw new Error(
      'Stores MMKV non initialisés — awaiter initSecureStorage() avant tout accès (gate S8).'
    );
  }
  return store;
}

/** Store chiffré de la file offline MOB-002 (lève avant init — gate S8). */
export function getOfflineQueueStorage(): MMKV {
  return assertReady(offlineQueueStorage);
}

/** Store chiffré de l'état du ticket MOB-004 (lève avant init — gate S8). */
export function getTicketStateStorage(): MMKV {
  return assertReady(ticketStateStorage);
}

/** Réservé aux tests : réinitialise le gate d'init entre deux cas. */
export function resetSecureStorageForTests(): void {
  offlineQueueStorage = null;
  ticketStateStorage = null;
  initPromise = null;
}
