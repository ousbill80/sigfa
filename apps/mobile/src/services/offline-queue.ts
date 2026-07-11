// offline-queue.ts — MOB-002
// File d'attente offline basée sur MMKV
import { MMKV } from 'react-native-mmkv';

const storage = new MMKV({ id: 'sigfa-offline-queue' });
const PENDING_KEY = 'pending_tickets';

export interface PendingTicket {
  idempotencyKey: string;
  agencyId: string;
  serviceId: string;
  phone: string;
  uemoaConsent: boolean;
  enqueuedAt: string;
}

/**
 * Ajoute un ticket en file d'attente offline.
 * Retourne la liste mise à jour.
 */
export function enqueue(ticket: PendingTicket): PendingTicket[] {
  const existing = getPendingTickets();
  const updated = [...existing, ticket];
  storage.set(PENDING_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Récupère tous les tickets en attente.
 */
export function getPendingTickets(): PendingTicket[] {
  const raw = storage.getString(PENDING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingTicket[];
  } catch {
    return [];
  }
}

/**
 * Supprime un ticket de la file après synchronisation.
 */
export function dequeue(idempotencyKey: string): PendingTicket[] {
  const existing = getPendingTickets();
  const updated = existing.filter(t => t.idempotencyKey !== idempotencyKey);
  storage.set(PENDING_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Vide complètement la file.
 */
export function clearQueue(): void {
  storage.delete(PENDING_KEY);
}
