// offline-queue.ts — MOB-002 (+ S7/S8 Boucle 2 F4)
// File d'attente offline basée sur MMKV — store CHIFFRÉ au repos (S8) :
// l'instance MMKV est fournie par secure-storage.ts (encryptionKey issue du
// trousseau système). Tout accès avant initSecureStorage() échoue fermé.
//
// S7 : les champs sont alignés sur le contrat public.yaml (PublicTicketMobile)
// — `phoneNumber` (ex-`phone`) et `smsConsent` (ex-`uemoaConsent`).
// Les entrées héritées (stade dev) sont MIGRÉES à la lecture, pas purgées.
import { getOfflineQueueStorage } from '@/services/secure-storage';

const PENDING_KEY = 'pending_tickets';

export interface PendingTicket {
  idempotencyKey: string;
  agencyId: string;
  serviceId: string;
  /** Numéro E.164 — nommage du contrat public.yaml (ex-`phone`). */
  phoneNumber: string;
  /** Opt-in SMS UEMOA — nommage du contrat public.yaml (ex-`uemoaConsent`). */
  smsConsent: boolean;
  enqueuedAt: string;
  /** Statut local connu (les clôturés sont purgés par flush() sans réseau). */
  status?: string;
}

/** Forme brute stockée — tolère les champs hérités d'avant S7. */
type StoredPendingTicket = Partial<PendingTicket> & {
  phone?: string;
  uemoaConsent?: boolean;
};

/** Migration à la lecture : entrées héritées → champs du contrat public.yaml. */
function normalizeEntry(entry: StoredPendingTicket): PendingTicket {
  const normalized: PendingTicket = {
    idempotencyKey: entry.idempotencyKey ?? '',
    agencyId: entry.agencyId ?? '',
    serviceId: entry.serviceId ?? '',
    phoneNumber: entry.phoneNumber ?? entry.phone ?? '',
    smsConsent: entry.smsConsent ?? entry.uemoaConsent ?? false,
    enqueuedAt: entry.enqueuedAt ?? '',
  };
  if (entry.status !== undefined) {
    normalized.status = entry.status;
  }
  return normalized;
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
 * Récupère tous les tickets en attente (entrées héritées migrées à la volée).
 */
export function getPendingTickets(): PendingTicket[] {
  const raw = getOfflineQueueStorage().getString(PENDING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredPendingTicket[];
    return parsed.map(normalizeEntry);
  } catch {
    return [];
  }
}

/**
 * Remplace le contenu de la file (utilisé par flush() pour les rejeux).
 */
export function setPendingTickets(tickets: PendingTicket[]): void {
  getOfflineQueueStorage().set(PENDING_KEY, JSON.stringify(tickets));
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
