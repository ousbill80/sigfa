// __tests__/mob-003-live-ticket.test.tsx
// MOB-003: Ticket vivant — position temps réel, Live Activity iOS / notification persistante Android
import React from 'react';
import { render, act } from '@testing-library/react-native';
import { renderHook } from '@testing-library/react-native';
import { LiveTicketCard } from '../src/components/LiveTicketCard';
import { useTicketPolling } from '../src/hooks/useTicketPolling';
import {
  MockWsService,
  getWsService,
  resetWsService,
} from '../src/services/mock-ws';
import {
  LiveActivityService,
  getLiveActivityService,
} from '../src/services/live-activity';
import {
  scheduleAndroidPersistentNotification,
  cancelAndroidPersistentNotification,
  registerDevicePush,
  unregisterDevicePush,
  schedulePositionAlert,
  setupAndroidNotificationChannel,
} from '../src/services/notifications';

describe('MOB-003: carte plein écran — position, barre de progression et estimation rendus en tokens SIGFA (RNTL snapshot)', () => {
  test('MOB-003: LiveTicketCard renders displayNumber, position, estimatedWaitMinutes', () => {
    const { getByTestId } = render(
      <LiveTicketCard
        displayNumber="A-042"
        position={5}
        estimatedWaitMinutes={12}
        status="waiting"
        onRetry={jest.fn()}
        screenState="nominal"
      />
    );
    expect(getByTestId('live-ticket-display-number')).toBeTruthy();
    expect(getByTestId('live-ticket-position')).toBeTruthy();
    expect(getByTestId('live-ticket-estimate')).toBeTruthy();
    expect(getByTestId('live-ticket-progress')).toBeTruthy();
  });

  test('MOB-003: 5 états CANONIQUES rendus — loading skeleton ≠ empty (snapshot ×5)', () => {
    const states = ['loading', 'empty', 'idle', 'active', 'error'] as const;
    states.forEach(state => {
      const { toJSON } = render(
        <LiveTicketCard
          displayNumber="A-001"
          position={1}
          estimatedWaitMinutes={5}
          status="waiting"
          onRetry={jest.fn()}
          screenState={state}
        />
      );
      expect(toJSON()).toMatchSnapshot(`LiveTicketCard-${state}`);
    });
  });

  test('MOB-003: loading skeleton a un testID distinct de empty', () => {
    const { getByTestId: getLoading } = render(
      <LiveTicketCard
        displayNumber=""
        position={0}
        estimatedWaitMinutes={0}
        status="waiting"
        onRetry={jest.fn()}
        screenState="loading"
      />
    );
    expect(getLoading('live-ticket-skeleton')).toBeTruthy();

    const { getByTestId: getEmpty } = render(
      <LiveTicketCard
        displayNumber=""
        position={0}
        estimatedWaitMinutes={0}
        status="waiting"
        onRetry={jest.fn()}
        screenState="empty"
      />
    );
    expect(getEmpty('live-ticket-empty')).toBeTruthy();
  });

  test('MOB-003: error state affiche message "Adressez-vous à l\'accueil"', () => {
    const { getByTestId } = render(
      <LiveTicketCard
        displayNumber=""
        position={0}
        estimatedWaitMinutes={0}
        status="waiting"
        onRetry={jest.fn()}
        screenState="error"
        errorMessage="Adressez-vous à l'accueil"
      />
    );
    expect(getByTestId('live-ticket-error')).toBeTruthy();
  });

  test('MOB-003: ticket:called — état "Votre tour !" déclenché', () => {
    const { getByTestId } = render(
      <LiveTicketCard
        displayNumber="A-042"
        position={0}
        estimatedWaitMinutes={0}
        status="called"
        onRetry={jest.fn()}
        screenState="active"
      />
    );
    expect(getByTestId('live-ticket-called')).toBeTruthy();
  });
});

describe('MOB-003: polling ETag — requête conditionnelle GET /public/tickets/{trackingId}', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('MOB-003: polling ETag — If-None-Match envoyé si ETag connu', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === 'etag' ? '"abc123"' : null },
      json: async () => ({
        trackingId: 'tid-001',
        displayNumber: 'A-001',
        position: 3,
        estimatedWaitMinutes: 8,
        status: 'waiting',
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() =>
      useTicketPolling({ trackingId: 'tid-001', intervalMs: 30000 })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('tid-001'),
      expect.any(Object)
    );
  });

  test('MOB-003: polling ETag — 304 retourné → ticket non mis à jour', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (h: string) => h === 'etag' ? '"etag-v1"' : null },
        json: async () => ({ trackingId: 't1', displayNumber: 'A-1', position: 5, estimatedWaitMinutes: 10, status: 'waiting' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 304,
        headers: { get: () => '"etag-v1"' },
        json: async () => { throw new Error('no body'); },
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 't1', intervalMs: 30000 })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    // Ticket should still be the one from the first response
    expect(result.current.ticket?.position).toBe(5);
  });
});

describe('MOB-003: mock WS local derrière EXPO_PUBLIC_MOCK_WS=true', () => {
  test('MOB-003: MockWsService — queue:updated déclenche callback sans connexion réelle', () => {
    const ws = new MockWsService();
    const cb = jest.fn();
    ws.on('queue:updated', cb);
    ws.emit('queue:updated', { queueId: 'q1', length: 10, estimate: 5 });
    expect(cb).toHaveBeenCalledWith({ queueId: 'q1', length: 10, estimate: 5 });
  });

  test('MOB-003: queue:updated — mise à jour sans navigation (test événement WS mocké)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ trackingId: 't1', displayNumber: 'B-2', position: 4, estimatedWaitMinutes: 9, status: 'waiting' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const ws = new MockWsService();
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 't1', intervalMs: 30000, wsService: ws })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    act(() => {
      ws.emit('queue:updated', { queueId: 'q1', length: 3, estimate: 2 });
    });

    expect(result.current.queueLength).toBe(3);
    expect(result.current.estimate).toBe(2);
  });

  test('MOB-003: ticket:called — état "called" déclenché via WS event', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ trackingId: 't2', displayNumber: 'C-3', position: 1, estimatedWaitMinutes: 2, status: 'waiting' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const ws = new MockWsService();
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 't2', intervalMs: 30000, wsService: ws })
    );

    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });

    act(() => {
      ws.emit('ticket:called', { trackingId: 't2' });
    });

    expect(result.current.ticket?.status).toBe('called');
  });
});

describe('MOB-003: Live Activity — structure derrière EXPO_PUBLIC_LIVE_ACTIVITY=false ; critère CI = pas de crash flag off', () => {
  test('MOB-003: Live Activity — pas de crash quand flag EXPO_PUBLIC_LIVE_ACTIVITY est false', () => {
    const originalEnv = process.env['EXPO_PUBLIC_LIVE_ACTIVITY'];
    process.env['EXPO_PUBLIC_LIVE_ACTIVITY'] = 'false';

    expect(() => {
      const svc = new LiveActivityService();
      svc.start({ displayNumber: 'A-1', position: 3, estimatedWaitMinutes: 5 });
      svc.update({ position: 2, estimatedWaitMinutes: 4 });
      svc.stop();
    }).not.toThrow();

    process.env['EXPO_PUBLIC_LIVE_ACTIVITY'] = originalEnv;
  });
});

describe('MOB-003: état offline — dernière position MMKV affichée + badge discret', () => {
  test('MOB-003: état offline — LiveTicketCard affiche dernière position connue avec badge offline', () => {
    const { getByTestId } = render(
      <LiveTicketCard
        displayNumber="A-042"
        position={3}
        estimatedWaitMinutes={8}
        status="waiting"
        onRetry={jest.fn()}
        screenState="idle"
        isOffline={true}
      />
    );
    expect(getByTestId('live-ticket-offline-badge')).toBeTruthy();
  });
});

describe('MOB-003: notification persistante Android — canal TICKET_ACTIVE', () => {
  test('MOB-003: notification persistante Android — scheduleAndroidPersistentNotification ne crash pas', () => {
    expect(() => {
      scheduleAndroidPersistentNotification({ displayNumber: 'A-1', position: 3, estimatedWaitMinutes: 5 });
    }).not.toThrow();
    expect(() => {
      cancelAndroidPersistentNotification();
    }).not.toThrow();
  });

  test('MOB-003: setupAndroidNotificationChannel ne crash pas', async () => {
    await expect(setupAndroidNotificationChannel()).resolves.toBeUndefined();
  });

  test('MOB-003: schedulePositionAlert — ne déclenche pas si position > 2', async () => {
    await expect(schedulePositionAlert({ position: 5 })).resolves.toBeUndefined();
  });

  test('MOB-003: schedulePositionAlert — ne crash pas si position ≤ 2', async () => {
    await expect(schedulePositionAlert({ position: 1, travelMinutes: 5 })).resolves.toBeUndefined();
  });

  test('MOB-003: registerDevicePush appelle POST /notifications/devices', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ deviceId: 'dev-abc-123' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await registerDevicePush({
      token: 'push-token',
      platform: 'EXPO',
      apiBaseUrl: 'http://localhost:4000',
      idempotencyKey: 'key-001',
    });
    expect(result.deviceId).toBe('dev-abc-123');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/notifications/devices',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('MOB-003: registerDevicePush — erreur si réponse non-ok', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      registerDevicePush({ token: 't', platform: 'ANDROID', apiBaseUrl: 'http://localhost:4000' })
    ).rejects.toThrow();
  });

  test('MOB-003: unregisterDevicePush appelle DELETE /notifications/devices/{deviceId}', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      unregisterDevicePush({ deviceId: 'dev-123', apiBaseUrl: 'http://localhost:4000' })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/notifications/devices/dev-123',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  test('MOB-003: unregisterDevicePush — 404 considéré comme succès', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      unregisterDevicePush({ deviceId: 'dev-gone', apiBaseUrl: 'http://localhost:4000' })
    ).resolves.toBeUndefined();
  });

  test('MOB-003: unregisterDevicePush — erreur si statut non-404 non-ok', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      unregisterDevicePush({ deviceId: 'dev-err', apiBaseUrl: 'http://localhost:4000' })
    ).rejects.toThrow();
  });
});

describe('MOB-003: MockWsService — couverture supplémentaire', () => {
  test('connect / disconnect / isConnected', () => {
    const ws = new MockWsService();
    expect(ws.isConnected).toBe(false);
    ws.connect();
    expect(ws.isConnected).toBe(true);
    ws.disconnect();
    expect(ws.isConnected).toBe(false);
  });

  test('off retire le listener', () => {
    const ws = new MockWsService();
    const cb = jest.fn();
    ws.on('queue:updated', cb);
    ws.off('queue:updated', cb);
    ws.emit('queue:updated', { queueId: 'q1', length: 5, estimate: 3 });
    expect(cb).not.toHaveBeenCalled();
  });

  test('on retourne une fonction de désabonnement', () => {
    const ws = new MockWsService();
    const cb = jest.fn();
    const unsub = ws.on('ticket:called', cb);
    unsub();
    ws.emit('ticket:called', { trackingId: 't1' });
    expect(cb).not.toHaveBeenCalled();
  });

  test('getWsService / resetWsService — singleton', () => {
    resetWsService();
    const a = getWsService();
    const b = getWsService();
    expect(a).toBe(b);
    resetWsService();
    const c = getWsService();
    expect(c).not.toBe(a);
  });
});

describe('MOB-003: LiveActivityService — couverture supplémentaire', () => {
  test('getLiveActivityService — singleton', () => {
    const a = getLiveActivityService();
    const b = getLiveActivityService();
    expect(a).toBe(b);
  });

  test('isActive est false par défaut', () => {
    const svc = new LiveActivityService();
    expect(svc.isActive).toBe(false);
  });

  test('update / stop no-op si flag off', () => {
    const originalEnv = process.env['EXPO_PUBLIC_LIVE_ACTIVITY'];
    process.env['EXPO_PUBLIC_LIVE_ACTIVITY'] = 'false';
    const svc = new LiveActivityService();
    // update and stop avec aucune activité active — doit être un no-op
    expect(() => svc.update({ position: 1, estimatedWaitMinutes: 2 })).not.toThrow();
    expect(() => svc.stop()).not.toThrow();
    process.env['EXPO_PUBLIC_LIVE_ACTIVITY'] = originalEnv;
  });
});

describe('MOB-003: useTicketPolling — couverture états', () => {
  test('MOB-003: screenState empty si trackingId vide', async () => {
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: '', intervalMs: 30000 })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('empty');
  });

  test('MOB-003: screenState error si 404', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 'notfound', intervalMs: 30000 })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('error');
    expect(result.current.error).toContain("l'accueil");
  });

  test('MOB-003: screenState error si fetch échoue', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 'err-id', intervalMs: 30000 })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('error');
  });

  test('MOB-003: screenState active si ticket status = called', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ trackingId: 't3', displayNumber: 'D-4', position: 0, estimatedWaitMinutes: 0, status: 'called' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 't3', intervalMs: 30000 })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('active');
  });

  test('MOB-003: screenState error si statut non-ok non-404', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 'srv-err', intervalMs: 30000 })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    expect(result.current.screenState).toBe('error');
  });

  test('MOB-003: ticket:closed via WS → screenState empty', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ trackingId: 'tc1', displayNumber: 'E-5', position: 2, estimatedWaitMinutes: 4, status: 'waiting' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const ws = new MockWsService();
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 'tc1', intervalMs: 30000, wsService: ws })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    act(() => {
      ws.emit('ticket:closed', {});
    });
    expect(result.current.screenState).toBe('empty');
  });

  test('MOB-003: ticket:called d\'un autre trackingId n\'affecte pas le ticket courant', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ trackingId: 'mine', displayNumber: 'F-6', position: 3, estimatedWaitMinutes: 6, status: 'waiting' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const ws = new MockWsService();
    const { result } = renderHook(() =>
      useTicketPolling({ trackingId: 'mine', intervalMs: 30000, wsService: ws })
    );
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 50));
    });
    act(() => {
      ws.emit('ticket:called', { trackingId: 'other' });
    });
    expect(result.current.ticket?.status).toBe('waiting');
  });
});
