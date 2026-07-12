// __tests__/mob-002-offline-enqueue.test.tsx
// MOB-002: offline — enqueue() écrit dans pending_tickets[] MMKV
// (S8 : le store est chiffré derrière le gate initSecureStorage())
import { enqueue, getPendingTickets, clearQueue, dequeue, type PendingTicket } from '../src/services/offline-queue';
import { initSecureStorage, resetSecureStorageForTests } from '../src/services/secure-storage';

// Mock MMKV storage (recrypt requis par le gate S8)
const mockStorage: Record<string, string> = {};
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn((key: string, value: string) => { mockStorage[key] = value; }),
    getString: jest.fn((key: string) => mockStorage[key]),
    delete: jest.fn((key: string) => { delete mockStorage[key]; }),
    contains: jest.fn((key: string) => key in mockStorage),
    recrypt: jest.fn(),
  })),
}));

describe('MOB-002: offline — enqueue() écrit dans pending_tickets[] MMKV', () => {
  beforeEach(async () => {
    // Clear mock storage before each test + passage du gate S8
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    resetSecureStorageForTests();
    await initSecureStorage();
  });

  test('enqueue() ajoute un ticket dans MMKV', () => {
    const ticket: PendingTicket = {
      idempotencyKey: 'test-key-001',
      agencyId: 'agency-1',
      serviceId: 'service-1',
      phoneNumber: '+2250102030405',
      smsConsent: true,
      enqueuedAt: new Date().toISOString(),
    };

    const result = enqueue(ticket);
    expect(result).toHaveLength(1);
    expect(result[0]?.idempotencyKey).toBe('test-key-001');
  });

  test('getPendingTickets() retourne les tickets enqueués', () => {
    const ticket: PendingTicket = {
      idempotencyKey: 'test-key-002',
      agencyId: 'agency-1',
      serviceId: 'service-1',
      phoneNumber: '+2250102030405',
      smsConsent: true,
      enqueuedAt: new Date().toISOString(),
    };

    enqueue(ticket);
    const pending = getPendingTickets();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.idempotencyKey).toBe('test-key-002');
  });

  test('enqueue() accumule plusieurs tickets', () => {
    for (let i = 0; i < 3; i++) {
      enqueue({
        idempotencyKey: `key-${i}`,
        agencyId: 'agency-1',
        serviceId: 'service-1',
        phoneNumber: '+2250102030405',
        smsConsent: true,
        enqueuedAt: new Date().toISOString(),
      });
    }
    expect(getPendingTickets()).toHaveLength(3);
  });

  test('clearQueue() vide la file', () => {
    enqueue({
      idempotencyKey: 'key-clear',
      agencyId: 'agency-1',
      serviceId: 'service-1',
      phoneNumber: '+2250102030405',
      smsConsent: true,
      enqueuedAt: new Date().toISOString(),
    });
    clearQueue();
    expect(getPendingTickets()).toHaveLength(0);
  });

  test('dequeue() supprime un ticket par idempotencyKey', () => {
    enqueue({ idempotencyKey: 'key-a', agencyId: 'a1', serviceId: 's1', phoneNumber: '+225', smsConsent: true, enqueuedAt: new Date().toISOString() });
    enqueue({ idempotencyKey: 'key-b', agencyId: 'a1', serviceId: 's1', phoneNumber: '+225', smsConsent: true, enqueuedAt: new Date().toISOString() });
    const remaining = dequeue('key-a');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.idempotencyKey).toBe('key-b');
  });

  test('getPendingTickets() retourne [] si JSON invalide', () => {
    // Corrupt the storage
    mockStorage['pending_tickets'] = '{invalid json}';
    const result = getPendingTickets();
    expect(result).toEqual([]);
  });

  test('getPendingTickets() retourne [] si vide', () => {
    const result = getPendingTickets();
    expect(result).toEqual([]);
  });
});
