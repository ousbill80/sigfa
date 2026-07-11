// mock-ws.ts — MOB-003
// Mock WebSocket service local derrière flag EXPO_PUBLIC_MOCK_WS=true
// Aucune connexion réseau réelle — utilisé uniquement dans les tests et en dev mock

export type WsEventName = 'queue:updated' | 'ticket:called' | 'ticket:closed' | 'sync:request';

export interface QueueUpdatedPayload {
  queueId: string;
  length: number;
  estimate: number;
}

export interface TicketCalledPayload {
  trackingId: string;
}

export type WsPayload = QueueUpdatedPayload | TicketCalledPayload | Record<string, unknown>;

type WsCallback = (payload: WsPayload) => void;

/**
 * MockWsService — émulateur d'événements Socket.io local.
 * Utilisé dans les tests (EXPO_PUBLIC_MOCK_WS=true) et en dev.
 * Aucune connexion réseau réelle ne peut être ouverte.
 */
export class MockWsService {
  private listeners: Map<WsEventName, WsCallback[]> = new Map();
  private _connected = false;

  connect(): void {
    this._connected = true;
    // En reconnexion, émettre sync:request (comportement socket réel)
    this.emit('sync:request', {});
  }

  disconnect(): void {
    this._connected = false;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  on(event: WsEventName, callback: WsCallback): () => void {
    const existing = this.listeners.get(event) ?? [];
    this.listeners.set(event, [...existing, callback]);
    return () => this.off(event, callback);
  }

  off(event: WsEventName, callback: WsCallback): void {
    const existing = this.listeners.get(event) ?? [];
    this.listeners.set(event, existing.filter(cb => cb !== callback));
  }

  emit(event: WsEventName, payload: WsPayload): void {
    const cbs = this.listeners.get(event) ?? [];
    cbs.forEach(cb => cb(payload));
  }
}

/**
 * Singleton de service WS en fonction du flag d'env.
 * En production (flag absent ou false), retourne un no-op stub.
 */
let _instance: MockWsService | null = null;

export function getWsService(): MockWsService {
  if (!_instance) {
    _instance = new MockWsService();
  }
  return _instance;
}

export function resetWsService(): void {
  _instance = null;
}
