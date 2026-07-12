// ticket-mmkv.ts — MOB-004 (+ S8 Boucle 2 F4)
// Persistance MMKV: trackingId, position, estimatedWaitMinutes, lastSyncAt
// TTL = durée de vie du ticket (clôture = purge MMKV)
// S8 : les stores MMKV sont CHIFFRÉS au repos et fournis par secure-storage.ts
// (encryptionKey issue du trousseau système) — plus aucune instance locale.
import {
  getOfflineQueueStorage,
  getTicketStateStorage,
} from '@/services/secure-storage';

const TICKET_STATE_KEY = 'ticket_state';

export interface TicketMMKVState {
  trackingId: string;
  position: number;
  estimatedWaitMinutes: number;
  lastSyncAt: string;
  status: 'waiting' | 'called' | 'served' | 'cancelled';
  displayNumber: string;
}

/**
 * Écrit l'état du ticket en MMKV après chaque polling réussi.
 */
export function writeTicketState(state: TicketMMKVState): void {
  getTicketStateStorage().set(TICKET_STATE_KEY, JSON.stringify(state));
}

/**
 * Lit l'état du ticket depuis MMKV.
 * Retourne null si aucun état stocké.
 */
export function readTicketState(): TicketMMKVState | null {
  const raw = getTicketStateStorage().getString(TICKET_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TicketMMKVState;
  } catch {
    return null;
  }
}

/**
 * Purge l'état du ticket (clôture du ticket ou TTL expirée).
 */
export function purgeTicketState(): void {
  getTicketStateStorage().delete(TICKET_STATE_KEY);
}

// ============================================================
// flush() FIFO — MOB-004
// Consomme la file pending_tickets[] depuis offline-queue.ts
// en FIFO, avec déduplication par X-Idempotency-Key,
// et purge des tickets clôturés (status served/cancelled).
// ============================================================

interface PendingTicketWithStatus {
  idempotencyKey: string;
  agencyId: string;
  serviceId: string;
  phone: string;
  uemoaConsent: boolean;
  enqueuedAt: string;
  status?: string;
}

const PENDING_KEY = 'pending_tickets';

function getPendingTickets(): PendingTicketWithStatus[] {
  const raw = getOfflineQueueStorage().getString(PENDING_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingTicketWithStatus[];
  } catch {
    return [];
  }
}

function setPendingTickets(tickets: PendingTicketWithStatus[]): void {
  getOfflineQueueStorage().set(PENDING_KEY, JSON.stringify(tickets));
}

export interface FlushOptions {
  apiBaseUrl: string;
}

/**
 * flush() — consomme la file FIFO pending_tickets[] de MOB-002:
 * 1. Déduplique par idempotencyKey (ne soumet qu'une fois chaque key)
 * 2. Purge les tickets clôturés (status served/cancelled) sans appel réseau
 * 3. Soumet les tickets en ordre FIFO via POST /tickets
 */
export async function flush({ apiBaseUrl }: FlushOptions): Promise<void> {
  const tickets = getPendingTickets();
  if (!tickets.length) return;

  // Déduplique par idempotencyKey (conserve la première occurrence = FIFO)
  const seen = new Set<string>();
  const deduped = tickets.filter(t => {
    if (seen.has(t.idempotencyKey)) return false;
    seen.add(t.idempotencyKey);
    return true;
  });

  // Purge les tickets clôturés sans appel réseau
  const toSubmit = deduped.filter(
    t => t.status !== 'served' && t.status !== 'cancelled'
  );

  // Soumet dans l'ordre FIFO
  const remaining: PendingTicketWithStatus[] = [];
  for (const ticket of toSubmit) {
    try {
      const res = await fetch(`${apiBaseUrl}/tickets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': ticket.idempotencyKey,
        },
        body: JSON.stringify({
          agencyId: ticket.agencyId,
          serviceId: ticket.serviceId,
          phone: ticket.phone,
          uemoaConsent: ticket.uemoaConsent,
          idempotencyKey: ticket.idempotencyKey,
        }),
      });

      if (!res.ok && res.status !== 409) {
        // 409 = déjà traité (idempotent) → considéré comme succès
        // Autre erreur → remettre dans la file pour le prochain flush
        remaining.push(ticket);
      }
      // Succès (2xx ou 409) → retiré de la file
    } catch {
      // Erreur réseau → remettre dans la file
      remaining.push(ticket);
    }
  }

  // Met à jour la file avec les tickets non encore soumis
  if (remaining.length > 0) {
    setPendingTickets(remaining);
  } else {
    getOfflineQueueStorage().delete(PENDING_KEY);
  }
}
