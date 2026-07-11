// useTicketPolling.ts — MOB-003
// Hook de polling du suivi ticket public avec cache ETag (30s) + intégration mock WS
import { useState, useEffect, useRef, useCallback } from 'react';
import { MockWsService, type QueueUpdatedPayload, type TicketCalledPayload, type WsPayload } from '@/services/mock-ws';

export interface TicketLiveStatus {
  trackingId: string;
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'called' | 'served' | 'cancelled';
}

export type LiveTicketScreenState = 'loading' | 'empty' | 'idle' | 'active' | 'error';

export interface UseTicketPollingReturn {
  ticket: TicketLiveStatus | null;
  screenState: LiveTicketScreenState;
  queueLength: number | null;
  estimate: number | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export interface UseTicketPollingOptions {
  trackingId: string;
  intervalMs?: number;
  wsService?: MockWsService;
  apiBaseUrl?: string;
}

function isQueueUpdated(p: WsPayload): p is QueueUpdatedPayload {
  return typeof (p as QueueUpdatedPayload).length === 'number';
}

function isTicketCalled(p: WsPayload): p is TicketCalledPayload {
  return typeof (p as TicketCalledPayload).trackingId === 'string';
}

export function useTicketPolling({
  trackingId,
  intervalMs = 30000,
  wsService,
  apiBaseUrl,
}: UseTicketPollingOptions): UseTicketPollingReturn {
  const baseUrl = apiBaseUrl ?? process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:4000';

  const [ticket, setTicket] = useState<TicketLiveStatus | null>(null);
  const [screenState, setScreenState] = useState<LiveTicketScreenState>('loading');
  const [queueLength, setQueueLength] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const etagRef = useRef<string | null>(null);

  const fetchTicket = useCallback(async (): Promise<void> => {
    if (!trackingId) {
      setScreenState('empty');
      return;
    }

    try {
      const headers: Record<string, string> = {};
      if (etagRef.current) {
        headers['If-None-Match'] = etagRef.current;
      }

      const res = await fetch(`${baseUrl}/public/tickets/${trackingId}`, { headers });

      if (res.status === 304) {
        // ETag unchanged — pas de mise à jour
        return;
      }

      if (res.status === 404) {
        setScreenState('error');
        setError("Adressez-vous à l'accueil");
        return;
      }

      if (!res.ok) {
        setScreenState('error');
        setError(`Erreur ${res.status}`);
        return;
      }

      const newEtag = res.headers?.get?.('etag') ?? null;
      if (newEtag) {
        etagRef.current = newEtag;
      }

      const data = await res.json() as TicketLiveStatus;
      setTicket(data);
      setError(null);

      if (data.status === 'called') {
        setScreenState('active');
      } else if (data.status === 'waiting') {
        setScreenState('idle');
      } else {
        setScreenState('idle');
      }
    } catch {
      setScreenState('error');
      setError('Erreur réseau');
    }
  }, [trackingId, baseUrl]);

  // Initial fetch
  useEffect(() => {
    void fetchTicket();
  }, [fetchTicket]);

  // Polling interval (30s)
  useEffect(() => {
    if (!intervalMs) return;
    const timer = setInterval(() => {
      void fetchTicket();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [fetchTicket, intervalMs]);

  // WS events (mock)
  useEffect(() => {
    if (!wsService) return;

    const offQueueUpdated = wsService.on('queue:updated', (payload) => {
      if (isQueueUpdated(payload)) {
        setQueueLength(payload.length);
        setEstimate(payload.estimate);
      }
    });

    const offTicketCalled = wsService.on('ticket:called', (payload) => {
      if (isTicketCalled(payload) && payload.trackingId === trackingId) {
        setTicket(prev => prev ? { ...prev, status: 'called' } : prev);
        setScreenState('active');
      }
    });

    const offTicketClosed = wsService.on('ticket:closed', () => {
      setScreenState('empty');
    });

    return () => {
      offQueueUpdated();
      offTicketCalled();
      offTicketClosed();
    };
  }, [wsService, trackingId]);

  return {
    ticket,
    screenState,
    queueLength,
    estimate,
    error,
    refresh: fetchTicket,
  };
}
