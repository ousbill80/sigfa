// offline-queue.ts — MOB-002 (+ S8 Boucle 2 F4)
// File d'attente offline basée sur MMKV — store CHIFFRÉ au repos (S8) :
// l'instance MMKV est fournie par secure-storage.ts (encryptionKey issue du
// trousseau système). Tout accès avant initSecureStorage() échoue fermé.
import { getOfflineQueueStorage } from '@/services/secure-storage';

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
  getOfflineQueueStorage().set(PENDING_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Récupère tous les tickets en attente.
 */
export function getPendingTickets(): PendingTicket[] {
  const raw = getOfflineQueueStorage().getString(PENDING_KEY);
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
  getOfflineQueueStorage().set(PENDING_KEY, JSON.stringify(updated));
  return updated;
}

/**
 * Vide complètement la file.
 */
export function clearQueue(): void {
  getOfflineQueueStorage().delete(PENDING_KEY);
}
