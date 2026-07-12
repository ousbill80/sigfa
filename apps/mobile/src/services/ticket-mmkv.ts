// ticket-mmkv.ts — MOB-004 (+ S7/S8 Boucle 2 F4)
// Persistance MMKV: trackingId, position, estimatedWaitMinutes, lastSyncAt
// TTL = durée de vie du ticket (clôture = purge MMKV)
// S8 : les stores MMKV sont CHIFFRÉS au repos et fournis par secure-storage.ts
// (encryptionKey issue du trousseau système) — plus aucune instance locale.
// S7 : flush() crée les tickets via POST /public/tickets (contrat public.yaml,
// channel MOBILE) à travers le client typé @sigfa/contracts — jamais /tickets.
import { createSigfaClient } from '@sigfa/contracts';

import { getTicketStateStorage } from '@/services/secure-storage';
import {
  getPendingTickets,
  setPendingTickets,
  clearQueue,
  type PendingTicket,
} from '@/services/offline-queue';

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
// flush() FIFO — MOB-004 (+ S7 Boucle 2 F4)
// Consomme la file pending_tickets[] depuis offline-queue.ts
// en FIFO, avec déduplication par X-Idempotency-Key,
// et purge des tickets clôturés (status served/cancelled).
// Soumission via le client typé @sigfa/contracts sur la route
// publique du contrat : POST /public/tickets (channel MOBILE).
// ============================================================

export interface FlushOptions {
  apiBaseUrl: string;
}

export interface FlushSubmission {
  idempotencyKey: string;
  /** trackingId nanoid(21) retourné par le serveur (PublicTicketCreatedResponse). */
  trackingId: string;
}

export interface FlushResult {
  /** Tickets créés côté serveur, dans l'ordre FIFO de soumission. */
  submitted: FlushSubmission[];
  /** Tickets restés en file (erreur réseau/serveur) — rejoués au prochain flush. */
  remainingCount: number;
}

/**
 * flush() — consomme la file FIFO pending_tickets[] de MOB-002 :
 * 1. Déduplique par idempotencyKey (ne soumet qu'une fois chaque clé)
 * 2. Purge les tickets clôturés (status served/cancelled) sans appel réseau
 * 3. Soumet en ordre FIFO via POST /public/tickets (client typé, channel MOBILE,
 *    X-Idempotency-Key en HEADER uniquement — jamais dans le body)
 * 4. Persiste le trackingId serveur (writeTicketState) pour le suivi MOB-003/004
 *
 * 409 IDEMPOTENCY_CONFLICT : retiré de la file — le rejeu de la même clé avec
 * le même payload aurait renvoyé 201 (idempotence 24 h) ; un 409 signifie un
 * payload divergent qui ne réussira jamais.
 */
export async function flush({ apiBaseUrl }: FlushOptions): Promise<FlushResult> {
  const tickets = getPendingTickets();
  if (!tickets.length) {
    return { submitted: [], remainingCount: 0 };
  }

  const client = createSigfaClient('public', apiBaseUrl);

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
  const submitted: FlushSubmission[] = [];
  const remaining: PendingTicket[] = [];
  for (const ticket of toSubmit) {
    try {
      const { data, response } = await client.POST('/public/tickets', {
        params: {
          header: { 'X-Idempotency-Key': ticket.idempotencyKey },
        },
        body: {
          channel: 'MOBILE',
          serviceId: ticket.serviceId,
          agencyId: ticket.agencyId,
          phoneNumber: ticket.phoneNumber,
          smsConsent: ticket.smsConsent,
        },
      });

      if (data) {
        submitted.push({
          idempotencyKey: ticket.idempotencyKey,
          trackingId: data.trackingId,
        });
        // Le trackingId public (nanoid 21) fait foi pour le suivi :
        // useTicketPolling / useOfflineTicketState lisent cet état.
        writeTicketState({
          trackingId: data.trackingId,
          position: data.position,
          estimatedWaitMinutes: data.estimatedWaitMinutes,
          lastSyncAt: new Date().toISOString(),
          status: 'waiting',
          displayNumber: data.displayNumber ?? data.number,
        });
      } else if (response.status !== 409) {
        // Erreur serveur (≠ conflit d'idempotence) → rejouer au prochain flush
        remaining.push(ticket);
      }
      // 409 IDEMPOTENCY_CONFLICT → retiré de la file (voir docstring)
    } catch {
      // Erreur réseau → remettre dans la file
      remaining.push(ticket);
    }
  }

  // Met à jour la file avec les tickets non encore soumis
  if (remaining.length > 0) {
    setPendingTickets(remaining);
  } else {
    clearQueue();
  }

  return { submitted, remainingCount: remaining.length };
}
