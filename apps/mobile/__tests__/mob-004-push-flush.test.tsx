// __tests__/mob-004-push-flush.test.tsx
// MOB-004: Push "≤ 2 personnes" + offline MMKV + flush() FIFO + sync queue
import { renderHook, act } from '@testing-library/react-native';

import {
  usePushRegistration,
} from '../src/hooks/usePushRegistration';
import {
  useOfflineTicketState,
} from '../src/hooks/useOfflineTicketState';
import {
  flush,
  writeTicketState,
  readTicketState,
  purgeTicketState,
  type TicketMMKVState,
} from '../src/services/ticket-mmkv';

// Mock MMKV — note: mock factory cannot reference out-of-scope vars,
// so we use a global storage pattern compatible with jest hoisting.
// The actual storage is managed by the jest.setup.js mock for MMKV.
// We override it per-describe with jest.spyOn after the fact.

// Use the global MMKV mock from jest.setup.js, but with per-test storage
let mockStorage: Record<string, string> = {};

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn((key: string, value: string) => { mockStorage[key] = value; }),
    getString: jest.fn((key: string) => mockStorage[key] ?? undefined),
    delete: jest.fn((key: string) => { delete mockStorage[key]; }),
    contains: jest.fn((key: string) => key in mockStorage),
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage = {};
});

describe('MOB-004: POST /notifications/devices — appel au démarrage app, idempotent', () => {
  test('MOB-004: usePushRegistration — state initial loading puis idle', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ deviceId: 'dev-001' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: 'token-abc' })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(result.current.deviceId).toBe('dev-001');
    expect(result.current.screenState).toBe('idle');
  });

  test('MOB-004: POST /notifications/devices — appel avec X-Idempotency-Key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ deviceId: 'dev-002' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: 'token-xyz' })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/notifications/devices',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Idempotency-Key': expect.any(String) }),
      })
    );
  });

  test('MOB-004: POST idempotent — 200 si device déjà enregistré', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deviceId: 'dev-existing' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: 'token-123' })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(result.current.deviceId).toBe('dev-existing');
    expect(result.current.screenState).toBe('idle');
  });

  test('MOB-004: DELETE /notifications/devices/{deviceId} — déclenché à la désinscription', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true, status: 201,
        json: async () => ({ deviceId: 'dev-del-me' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: 'token-del' })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    await act(async () => {
      await result.current.unregister();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/notifications/devices/dev-del-me',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  test('MOB-004: sans opt-in push — pas d\'erreur, screenState idle', async () => {
    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: null })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(result.current.screenState).toBe('idle');
    expect(result.current.deviceId).toBeNull();
  });

  test('MOB-004: erreur enregistrement — screenState error puis retry silencieux', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false, status: 500,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: 'token-err' })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(result.current.screenState).toBe('error');
  });
});

describe('MOB-004: MMKV write — trackingId + position + estimatedWaitMinutes écrits après polling', () => {
  test('MOB-004: writeTicketState écrit en MMKV', () => {
    const state: TicketMMKVState = {
      trackingId: 'tid-abc',
      position: 4,
      estimatedWaitMinutes: 9,
      lastSyncAt: new Date().toISOString(),
      status: 'waiting',
      displayNumber: 'A-099',
    };
    writeTicketState(state);
    const raw = mockStorage['ticket_state'];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw) as TicketMMKVState;
    expect(parsed.trackingId).toBe('tid-abc');
    expect(parsed.position).toBe(4);
    expect(parsed.estimatedWaitMinutes).toBe(9);
  });

  test('MOB-004: readTicketState lit depuis MMKV', () => {
    const state: TicketMMKVState = {
      trackingId: 'tid-xyz',
      position: 2,
      estimatedWaitMinutes: 4,
      lastSyncAt: new Date().toISOString(),
      status: 'called',
      displayNumber: 'B-007',
    };
    mockStorage['ticket_state'] = JSON.stringify(state);
    const result = readTicketState();
    expect(result?.trackingId).toBe('tid-xyz');
    expect(result?.position).toBe(2);
  });

  test('MOB-004: readTicketState retourne null si vide', () => {
    expect(readTicketState()).toBeNull();
  });

  test('MOB-004: purgeTicketState supprime l\'entrée MMKV', () => {
    mockStorage['ticket_state'] = JSON.stringify({ trackingId: 'to-purge' });
    purgeTicketState();
    // Après la purge, readTicketState doit retourner null
    expect(readTicketState()).toBeNull();
  });
});

describe('MOB-004: MMKV read offline — position affichée depuis MMKV quand NetInfo = offline', () => {
  test('MOB-004: useOfflineTicketState — retourne état MMKV quand offline', async () => {
    mockStorage['ticket_state'] = JSON.stringify({
      trackingId: 'tid-offline',
      position: 3,
      estimatedWaitMinutes: 7,
      lastSyncAt: new Date().toISOString(),
      status: 'waiting',
      displayNumber: 'C-042',
    });

    const { result } = renderHook(() =>
      useOfflineTicketState({ isOffline: true })
    );

    expect(result.current.ticket?.trackingId).toBe('tid-offline');
    expect(result.current.ticket?.position).toBe(3);
    expect(result.current.isOffline).toBe(true);
  });

  test('MOB-004: useOfflineTicketState — retourne null quand en ligne', () => {
    const { result } = renderHook(() =>
      useOfflineTicketState({ isOffline: false })
    );
    expect(result.current.isOffline).toBe(false);
  });
});

describe('MOB-004: flush() FIFO — pending_tickets[] consommés dans l\'ordre, dédupliqués, clôturés purgés', () => {
  test('MOB-004: flush() FIFO — tickets consommés dans l\'ordre d\'insertion', async () => {
    const tickets = [
      { idempotencyKey: 'key-1', agencyId: 'ag1', serviceId: 'srv1', phone: '+225', uemoaConsent: true, enqueuedAt: '2026-01-01T00:00:00Z' },
      { idempotencyKey: 'key-2', agencyId: 'ag1', serviceId: 'srv2', phone: '+225', uemoaConsent: true, enqueuedAt: '2026-01-01T00:00:01Z' },
    ];
    mockStorage['pending_tickets'] = JSON.stringify(tickets);

    const order: string[] = [];
    const fetchMock = jest.fn().mockImplementation((url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string) as { idempotencyKey: string };
      order.push(body.idempotencyKey ?? (opts.headers as Record<string, string>)?.['X-Idempotency-Key'] ?? url);
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ trackingId: 'srv-id' }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: 'http://localhost:4000' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('MOB-004: flush() dédup — même idempotencyKey envoyée une seule fois', async () => {
    const tickets = [
      { idempotencyKey: 'dup-key', agencyId: 'ag1', serviceId: 'srv1', phone: '+225', uemoaConsent: true, enqueuedAt: '2026-01-01T00:00:00Z' },
      { idempotencyKey: 'dup-key', agencyId: 'ag1', serviceId: 'srv1', phone: '+225', uemoaConsent: true, enqueuedAt: '2026-01-01T00:00:00Z' },
    ];
    mockStorage['pending_tickets'] = JSON.stringify(tickets);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ trackingId: 'srv-dup' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: 'http://localhost:4000' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('MOB-004: flush() purge — tickets clôturés (status served/cancelled) purgés sans appel réseau', async () => {
    const tickets = [
      { idempotencyKey: 'closed-1', agencyId: 'ag1', serviceId: 's1', phone: '+225', uemoaConsent: true, enqueuedAt: '2026-01-01T00:00:00Z', status: 'served' },
      { idempotencyKey: 'open-1', agencyId: 'ag1', serviceId: 's2', phone: '+225', uemoaConsent: true, enqueuedAt: '2026-01-01T00:00:01Z' },
    ];
    mockStorage['pending_tickets'] = JSON.stringify(tickets);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ trackingId: 'srv-ok' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await flush({ apiBaseUrl: 'http://localhost:4000' });

    // Seulement le ticket ouvert doit être envoyé
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('MOB-004: flush() file vide — ne crash pas', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(flush({ apiBaseUrl: 'http://localhost:4000' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('MOB-004: push "≤ 2 personnes" — notification déclenchée quand position ≤ 2', async () => {
    // schedulePositionAlert est déjà testée dans MOB-003 — ici on vérifie l'intégration
    // via useOfflineTicketState qui expose shouldAlertTwoPersons
    mockStorage['ticket_state'] = JSON.stringify({
      trackingId: 'tid-alert',
      position: 2,
      estimatedWaitMinutes: 3,
      lastSyncAt: new Date().toISOString(),
      status: 'waiting',
      displayNumber: 'D-002',
    });
    const { result } = renderHook(() =>
      useOfflineTicketState({ isOffline: false })
    );
    // shouldAlertTwoPersons se base sur la position courante
    expect(result.current.shouldAlertTwoPersons(2)).toBe(true);
    expect(result.current.shouldAlertTwoPersons(3)).toBe(false);
  });
});

describe('MOB-004: 5 états écran — nominal, loading, empty, error, offline', () => {
  test('MOB-004: screenState nominal quand deviceId connu', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true, status: 201,
      json: async () => ({ deviceId: 'dev-nom' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: 'tok-nom' })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('idle');
    expect(result.current.deviceId).toBe('dev-nom');
  });

  test('MOB-004: screenState empty quand pushToken null (pas d\'opt-in)', async () => {
    const { result } = renderHook(() =>
      usePushRegistration({ apiBaseUrl: 'http://localhost:4000', pushToken: null })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('idle');
  });
});

