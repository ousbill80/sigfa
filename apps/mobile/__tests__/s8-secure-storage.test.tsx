// __tests__/s8-secure-storage.test.tsx
// Boucle 2 F4 — S8 (finding sécurité MAJOR du panel, arbitrage 33-boucle1-panel-f4) :
// les stores MMKV portant des PII (téléphone UEMOA) doivent être chiffrés au repos
// avec une encryptionKey générée par aléa cryptographique et conservée dans le
// trousseau système (expo-secure-store). Init async gatée avant tout accès MMKV.

// ─── Mocks locaux : capture des arguments de construction MMKV ────────────────
const mmkvConstructorCalls: { id: string; encryptionKey?: string }[] = [];
const recryptCalls: (string | undefined)[] = [];
const mockStorage: Record<string, string> = {};

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation((config: { id: string; encryptionKey?: string }) => {
    mmkvConstructorCalls.push(config);
    return {
      set: jest.fn((key: string, value: string) => { mockStorage[key] = value; }),
      getString: jest.fn((key: string) => mockStorage[key]),
      delete: jest.fn((key: string) => { delete mockStorage[key]; }),
      contains: jest.fn((key: string) => key in mockStorage),
      recrypt: jest.fn((key: string | undefined) => { recryptCalls.push(key); }),
    };
  }),
}));

// SecureStore mock : trousseau en mémoire contrôlable par test
const secureStoreData: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(secureStoreData[key] ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    secureStoreData[key] = value;
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    delete secureStoreData[key];
    return Promise.resolve();
  }),
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
}));

// expo-crypto mock : aléa déterministe pour les assertions
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn((count: number) =>
    Promise.resolve(Uint8Array.from({ length: count }, (_, i) => (i * 31 + 7) % 256))
  ),
}));

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {
  initSecureStorage,
  getOfflineQueueStorage,
  getTicketStateStorage,
  resetSecureStorageForTests,
  MMKV_ENCRYPTION_KEY_NAME,
  OFFLINE_QUEUE_STORE_ID,
  TICKET_STATE_STORE_ID,
} from '../src/services/secure-storage';
import { enqueue, getPendingTickets, clearQueue } from '../src/services/offline-queue';

beforeEach(() => {
  jest.clearAllMocks();
  resetSecureStorageForTests();
  mmkvConstructorCalls.length = 0;
  recryptCalls.length = 0;
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  Object.keys(secureStoreData).forEach(k => delete secureStoreData[k]);
});

describe('S8: gate d\'init — aucun accès MMKV avant initSecureStorage()', () => {
  test('S8: getOfflineQueueStorage() lève une erreur explicite avant init', () => {
    expect(() => getOfflineQueueStorage()).toThrow(/initSecureStorage/);
  });

  test('S8: getTicketStateStorage() lève une erreur explicite avant init', () => {
    expect(() => getTicketStateStorage()).toThrow(/initSecureStorage/);
  });

  test('S8: après init, les deux getters retournent un store', async () => {
    await initSecureStorage();
    expect(getOfflineQueueStorage()).toBeDefined();
    expect(getTicketStateStorage()).toBeDefined();
  });
});

describe('S8: première ouverture — clé générée (aléa crypto), stockée en SecureStore, stores recryptés', () => {
  test('S8: la clé est générée via expo-crypto (32 octets) et persistée dans le trousseau', async () => {
    await initSecureStorage();

    expect(Crypto.getRandomBytesAsync).toHaveBeenCalledWith(32);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      MMKV_ENCRYPTION_KEY_NAME,
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.objectContaining({ keychainAccessible: 'AFTER_FIRST_UNLOCK' })
    );
  });

  test('S8: première init — données claires préexistantes migrées via recrypt(clé)', async () => {
    await initSecureStorage();

    // Les deux stores PII sont chiffrés en place (migration du clair, stade dev)
    expect(recryptCalls).toHaveLength(2);
    const storedKey = secureStoreData[MMKV_ENCRYPTION_KEY_NAME];
    expect(storedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(recryptCalls[0]).toBe(storedKey);
    expect(recryptCalls[1]).toBe(storedKey);
  });

  test('S8: les stores ouverts couvrent bien sigfa-offline-queue et sigfa-ticket-state', async () => {
    await initSecureStorage();

    const ids = mmkvConstructorCalls.map(c => c.id);
    expect(ids).toContain(OFFLINE_QUEUE_STORE_ID);
    expect(ids).toContain(TICKET_STATE_STORE_ID);
  });
});

describe('S8: ouvertures suivantes — clé relue du trousseau, MMKV ouvert chiffré directement', () => {
  test('S8: clé existante — pas de régénération, MMKV construit avec encryptionKey', async () => {
    secureStoreData[MMKV_ENCRYPTION_KEY_NAME] = 'a'.repeat(64);

    await initSecureStorage();

    expect(Crypto.getRandomBytesAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(recryptCalls).toHaveLength(0);
    for (const call of mmkvConstructorCalls) {
      expect(call.encryptionKey).toBe('a'.repeat(64));
    }
  });

  test('S8: init idempotente — deux awaits, une seule ouverture des stores', async () => {
    await initSecureStorage();
    const openedAfterFirst = mmkvConstructorCalls.length;
    await initSecureStorage();
    expect(mmkvConstructorCalls.length).toBe(openedAfterFirst);
  });
});

describe('S8: la file offline MOB-002 fonctionne inchangée derrière le store chiffré', () => {
  test('S8: enqueue/getPendingTickets/clearQueue opèrent sur le store chiffré', async () => {
    await initSecureStorage();

    enqueue({
      idempotencyKey: 'k-s8-001',
      agencyId: 'agency-1',
      serviceId: 'service-1',
      phoneNumber: '+2250102030405',
      smsConsent: true,
      enqueuedAt: new Date().toISOString(),
    });

    expect(getPendingTickets()).toHaveLength(1);
    expect(getPendingTickets()[0]?.idempotencyKey).toBe('k-s8-001');

    clearQueue();
    expect(getPendingTickets()).toHaveLength(0);
  });

  test('S8: le numéro de téléphone ne transite plus par un store non chiffré', async () => {
    await initSecureStorage();
    // Tous les stores construits après init portent une encryptionKey
    // OU ont été recryptés immédiatement (migration première ouverture).
    for (let i = 0; i < mmkvConstructorCalls.length; i++) {
      const call = mmkvConstructorCalls[i];
      const encrypted = typeof call?.encryptionKey === 'string' && call.encryptionKey.length === 64;
      const recrypted = recryptCalls.length >= mmkvConstructorCalls.length;
      expect(encrypted || recrypted).toBe(true);
    }
  });
});
