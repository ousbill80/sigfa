// __tests__/s7-flush-public-contract.test.tsx
// Boucle 2 F4 — S7 (finding sécurité MAJOR du panel, arbitrage 33-boucle1-panel-f4) :
// flush() doit créer les tickets via POST /public/tickets (route publique du
// contrat public.yaml, channel MOBILE) à travers le client typé @sigfa/contracts.
// - body conforme PublicTicketMobile : channel/serviceId/agencyId/phoneNumber/smsConsent
// - X-Idempotency-Key en HEADER uniquement (jamais dans le body)
// - rejeu même clé = une seule soumission côté client
// - trackingId serveur persisté pour le suivi (useTicketPolling / MOB-004)
import { renderHook, act } from '@testing-library/react-native';

import { flush, readTicketState } from '../src/services/ticket-mmkv';
import { getPendingTickets } from '../src/services/offline-queue';
import { useTicketFlow } from '../src/hooks/useTicketFlow';
import {
  initSecureStorage,
  resetSecureStorageForTests,
} from '../src/services/secure-storage';

// Mock MMKV local avec stockage en mémoire (recrypt requis par le gate S8)
let mockStorage: Record<string, string> = {};
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn((key: string, value: string) => { mockStorage[key] = value; }),
    getString: jest.fn((key: string) => mockStorage[key] ?? undefined),
    delete: jest.fn((key: string) => { delete mockStorage[key]; }),
    contains: jest.fn((key: string) => key in mockStorage),
    recrypt: jest.fn(),
  })),
}));

const API = 'http://localhost:4000';

/** Ticket en file au format contrat (S7). */
function pendingTicket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotencyKey: 'V9k2mXpLqRwZsYn8fBjH3',
    agencyId: '33333333-3333-4333-a333-333333333333',
    serviceId: '77777777-7777-4777-a777-777777777777',
    phoneNumber: '+2250700000002',
    smsConsent: true,
    enqueuedAt: '2026-07-12T08:00:00Z',
    ...overrides,
  };
}

/** Réponse 201 conforme PublicTicketCreatedResponse (contrat public.yaml). */
function created201(trackingId = 'Mn4pQrStUvWxYzAb5cDeF'): Response {
  return new Response(
    JSON.stringify({
      trackingId,
      number: 'A044',
      displayNumber: 'OA-044',
      status: 'WAITING',
      priority: 'STANDARD',
      channel: 'MOBILE',
      position: 7,
      estimatedWaitMinutes: 14,
      serviceId: '77777777-7777-4777-a777-777777777777',
      agencyId: '33333333-3333-4333-a333-333333333333',
      createdAt: '2026-07-12T09:02:00Z',
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}

function errorResponse(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message: code } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

/** Extrait la requête n° i du mock fetch (le client typé passe un objet Request). */
function requestAt(fetchMock: jest.Mock, i = 0): Request {
  const arg: unknown = fetchMock.mock.calls[i]?.[0];
  expect(arg).toBeInstanceOf(Request);
  return arg as Request;
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockStorage = {};
  resetSecureStorageForTests();
  await initSecureStorage();
});

describe('S7: flush() crée les tickets via POST /public/tickets (contrat public.yaml)', () => {
  test('S7: la route appelée est POST {api}/public/tickets — plus jamais /tickets (route AGENT)', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockResolvedValue(created201());
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: API });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = requestAt(fetchMock);
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${API}/public/tickets`);
  });

  test('S7: body conforme PublicTicketMobile — channel MOBILE + phoneNumber + smsConsent, rien d\'autre', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockResolvedValue(created201());
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: API });

    const body = await requestAt(fetchMock).json() as Record<string, unknown>;
    expect(body).toEqual({
      channel: 'MOBILE',
      serviceId: '77777777-7777-4777-a777-777777777777',
      agencyId: '33333333-3333-4333-a333-333333333333',
      phoneNumber: '+2250700000002',
      smsConsent: true,
    });
    // Champs HORS CONTRAT interdits dans le body
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('uemoaConsent');
    expect(body).not.toHaveProperty('idempotencyKey');
  });

  test('S7: X-Idempotency-Key transmis en HEADER uniquement', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockResolvedValue(created201());
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: API });

    const req = requestAt(fetchMock);
    expect(req.headers.get('x-idempotency-key')).toBe('V9k2mXpLqRwZsYn8fBjH3');
    const body = await req.json() as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('idempotencyKey');
  });

  test('S7: rejeu même clé — une seule soumission (pas de doublon côté client)', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([
      pendingTicket(),
      pendingTicket({ enqueuedAt: '2026-07-12T08:00:01Z' }),
    ]);
    const fetchMock = jest.fn().mockResolvedValue(created201());
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: API });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getPendingTickets()).toHaveLength(0);
  });

  test('S7: 201 → trackingId nanoid(21) du serveur persisté pour le suivi (polling MOB-003/004)', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockResolvedValue(created201('Mn4pQrStUvWxYzAb5cDeF'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await flush({ apiBaseUrl: API });

    expect(result.submitted).toEqual([
      { idempotencyKey: 'V9k2mXpLqRwZsYn8fBjH3', trackingId: 'Mn4pQrStUvWxYzAb5cDeF' },
    ]);
    const state = readTicketState();
    expect(state?.trackingId).toBe('Mn4pQrStUvWxYzAb5cDeF');
    expect(state?.trackingId).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(state?.position).toBe(7);
    expect(state?.estimatedWaitMinutes).toBe(14);
    expect(state?.status).toBe('waiting');
    expect(state?.displayNumber).toBe('OA-044');
  });

  test('S7: 409 IDEMPOTENCY_CONFLICT → retiré de la file (le rejeu ne réussira jamais)', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockResolvedValue(errorResponse(409, 'IDEMPOTENCY_CONFLICT'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await flush({ apiBaseUrl: API });

    expect(result.submitted).toHaveLength(0);
    expect(getPendingTickets()).toHaveLength(0);
  });

  test('S7: erreur serveur 500 → le ticket reste en file pour le prochain flush', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockResolvedValue(errorResponse(500, 'INTERNAL_ERROR'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await flush({ apiBaseUrl: API });

    expect(result.remainingCount).toBe(1);
    expect(getPendingTickets()).toHaveLength(1);
  });

  test('S7: erreur réseau → le ticket reste en file pour le prochain flush', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([pendingTicket()]);
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await flush({ apiBaseUrl: API });

    expect(result.remainingCount).toBe(1);
    expect(getPendingTickets()).toHaveLength(1);
  });
});

describe('S7: migration des entrées MMKV héritées (phone/uemoaConsent → phoneNumber/smsConsent)', () => {
  test('S7: getPendingTickets() migre les entrées héritées vers les champs du contrat', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([
      {
        idempotencyKey: 'legacy-key-0000000001',
        agencyId: 'agency-1',
        serviceId: 'service-1',
        phone: '+2250102030405',
        uemoaConsent: true,
        enqueuedAt: '2026-07-11T00:00:00Z',
      },
    ]);

    const pending = getPendingTickets();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.phoneNumber).toBe('+2250102030405');
    expect(pending[0]?.smsConsent).toBe(true);
    expect(pending[0]).not.toHaveProperty('phone');
    expect(pending[0]).not.toHaveProperty('uemoaConsent');
  });

  test('S7: entrée incomplète/corrompue → normalisée avec des valeurs par défaut sûres', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([{}]);

    const pending = getPendingTickets();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      idempotencyKey: '',
      agencyId: '',
      serviceId: '',
      phoneNumber: '',
      smsConsent: false,
      enqueuedAt: '',
    });
  });

  test('S7: flush() d\'une entrée héritée poste le body contrat (phoneNumber/smsConsent)', async () => {
    mockStorage['pending_tickets'] = JSON.stringify([
      {
        idempotencyKey: 'legacy-key-0000000002',
        agencyId: '33333333-3333-4333-a333-333333333333',
        serviceId: '77777777-7777-4777-a777-777777777777',
        phone: '+2250102030405',
        uemoaConsent: true,
        enqueuedAt: '2026-07-11T00:00:00Z',
      },
    ]);
    const fetchMock = jest.fn().mockResolvedValue(created201());
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: API });

    const body = await requestAt(fetchMock).json() as Record<string, unknown>;
    expect(body['phoneNumber']).toBe('+2250102030405');
    expect(body['smsConsent']).toBe(true);
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('uemoaConsent');
  });
});

describe('S7: useTicketFlow enqueue au format contrat', () => {
  test('S7: goToStep3 enqueue phoneNumber/smsConsent (plus phone/uemoaConsent)', async () => {
    const { result } = renderHook(() => useTicketFlow());
    act(() => {
      result.current.setAgency('agency-1');
      result.current.setService('service-1');
      result.current.setPhone('+2250700000002');
      result.current.setUemoaConsent(true);
    });
    await act(async () => {
      await result.current.goToStep3();
    });

    const pending = getPendingTickets();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.phoneNumber).toBe('+2250700000002');
    expect(pending[0]?.smsConsent).toBe(true);
    expect(pending[0]).not.toHaveProperty('phone');
    expect(pending[0]).not.toHaveProperty('uemoaConsent');
  });
});
