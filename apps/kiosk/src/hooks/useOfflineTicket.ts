/**
 * KIOSK-006 — useOfflineTicket hook (implémentation, remplace le stub KIOSK-004)
 *
 * Offline-first complet :
 *  - `createOfflineTicket()` : persiste un ticket LOCAL dans Dexie (IndexedDB),
 *    avec `localUuid` UUID v4 et numérotation locale séquentielle (jamais de
 *    doublon visible). L'interface de retour est IDENTIQUE au stub KIOSK-004
 *    (le parcours client reste inchangé online/offline).
 *  - `syncPendingTickets()` : au retour réseau, POST `/tickets/sync` via
 *    `@sigfa/contracts` (batch ≤ 100, `X-Idempotency-Key` UUID v4), réconcilie
 *    `localUuid ↔ serverId` (200), découpe et rejoue sur 422 `BATCH_TOO_LARGE`,
 *    et logue silencieusement les `skipped` (ZÉRO alerte émise par la borne —
 *    l'alerte `KIOSK_SYSTEM_ERROR` est émise par le SERVEUR/API-005).
 */
"use client";

import { createSigfaClient } from "@sigfa/contracts";
import {
  getOfflineDb,
  formatLocalNumber,
  nextLocalSequence,
  KIOSK_CHANNEL,
  type OfflineTicketRow,
  type OfflineTicketDatabase,
} from "@/lib/offline-db";
import {
  ensureKioskSession,
  getKioskSessionToken,
} from "@/lib/kiosk-session-store";

/** Taille maximale d'un batch de synchronisation (contrat API-005). */
export const MAX_SYNC_BATCH = 100;

/** Résultat d'un ticket offline — interface stable depuis KIOSK-004. */
export interface OfflineTicketResult {
  trackingId: string;
  displayNumber: string;
  position: number;
  estimatedWaitMinutes: number;
  isOffline: true;
}

/** Options d'émission d'un ticket offline. */
export interface CreateOfflineTicketOptions {
  serviceId?: string;
  agencyId?: string;
}

/** Bilan d'une synchronisation. */
export interface SyncResult {
  /** Nombre de tickets réconciliés (localUuid → serverId) puis purgés. */
  syncedCount: number;
  /** Nombre de tickets ignorés par le serveur (logués, non alertés). */
  skippedCount: number;
}

/** Base URL de l'API — mock Prism canonique par défaut (RT-001b). */
function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
}

/** Découpe une liste en tranches de taille `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Coupe une liste en deux moitiés (redécoupage sur 422 d'un batch ≤ 100). */
function splitInHalf<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

/**
 * Persiste un ticket localement (Dexie) et renvoie le Moment Ticket.
 * Le `localUuid` est un UUID v4 client ; le numéro affiché dérive du
 * compteur local séquentiel.
 */
async function persistOfflineTicket(
  db: OfflineTicketDatabase,
  options: CreateOfflineTicketOptions
): Promise<OfflineTicketResult> {
  const localUuid = crypto.randomUUID();
  const localSequence = await nextLocalSequence(db);
  const displayNumber = formatLocalNumber(localSequence);
  const createdOfflineAt = new Date().toISOString();

  const row: OfflineTicketRow = {
    localUuid,
    serviceId: options.serviceId ?? "",
    agencyId: options.agencyId ?? "",
    channel: KIOSK_CHANNEL,
    localSequence,
    displayNumber,
    createdOfflineAt,
  };
  await db.tickets.put(row);

  // Position = rang dans la file locale (tickets en attente de sync).
  const pending = await db.tickets.count();

  return {
    trackingId: localUuid,
    displayNumber,
    position: pending,
    estimatedWaitMinutes: 0,
    isOffline: true,
  };
}

/**
 * Synchronise un unique batch via le client typé core.
 * Retourne les localUuid réconciliés à purger + le nombre de skipped.
 * Sur 422 BATCH_TOO_LARGE, redécoupe en batches de MAX_SYNC_BATCH (ou en
 * demi-batches si le lot est déjà ≤ 100) et rejoue.
 */
async function syncBatch(
  rows: OfflineTicketRow[]
): Promise<{ syncedLocalUuids: string[]; skippedCount: number }> {
  // S5 : la route /tickets/sync exige le scope agency (contrat core) — le
  // Bearer de la session borne est porté par chaque batch. Sans session
  // (borne dégradée), l'appel part sans token : rien n'est purgé, rejeu au
  // rétablissement de la session.
  const token = getKioskSessionToken();
  const client = createSigfaClient("core", apiBaseUrl(), token ? { token } : {});
  const { data, response } = await client.POST("/tickets/sync", {
    params: {
      header: {
        "X-Idempotency-Key": crypto.randomUUID(),
      },
    },
    body: {
      tickets: rows.map((r) => ({
        localUuid: r.localUuid,
        serviceId: r.serviceId,
        channel: "KIOSK" as const,
        createdOfflineAt: r.createdOfflineAt,
      })),
    },
  });

  // 422 BATCH_TOO_LARGE → découpe et rejoue.
  if (response.status === 422) {
    const byMax = chunk(rows, MAX_SYNC_BATCH);
    const parts = byMax.length > 1 ? byMax : splitInHalf(rows);
    let syncedLocalUuids: string[] = [];
    let skippedCount = 0;
    for (const part of parts) {
      const res = await syncBatch(part);
      syncedLocalUuids = syncedLocalUuids.concat(res.syncedLocalUuids);
      skippedCount += res.skippedCount;
    }
    return { syncedLocalUuids, skippedCount };
  }

  if (response.status === 200 && data) {
    const synced = data.synced ?? [];
    const skipped = data.skipped ?? [];
    // skipped → log interne uniquement, ZÉRO alerte émise par la borne.
    for (const s of skipped) {
      console.warn(
        `[kiosk][offline-sync] ticket ignoré localUuid=${s.localUuid} raison=${s.reason}`
      );
    }
    return {
      syncedLocalUuids: synced.map((s) => s.localUuid),
      skippedCount: skipped.length,
    };
  }

  // Autre statut (réseau/erreur serveur) : on ne purge rien, on retentera.
  return { syncedLocalUuids: [], skippedCount: 0 };
}

export function useOfflineTicket() {
  /**
   * Émet un ticket LOCAL (Dexie) et renvoie le Moment Ticket.
   * Compatible KIOSK-004 : appelable sans argument.
   */
  const createOfflineTicket = async (
    options: CreateOfflineTicketOptions = {}
  ): Promise<OfflineTicketResult> => {
    const db = getOfflineDb();
    return persistOfflineTicket(db, options);
  };

  /**
   * Synchronise tous les tickets en attente (batch ≤ 100, idempotent).
   * Réconcilie puis PURGE les entrées Dexie correspondantes. Rejouable :
   * un même batch rejoué 2× ne crée aucun doublon (déjà purgé, ou serveur
   * répond skipped/ALREADY_SYNCED → jamais de nouvelle entrée locale).
   */
  const syncPendingTickets = async (): Promise<SyncResult> => {
    const db = getOfflineDb();
    const pending = await db.tickets.orderBy("createdOfflineAt").toArray();
    if (pending.length === 0) {
      return { syncedCount: 0, skippedCount: 0 };
    }

    // S5 : session borne garantie avant la sync — RE-CRÉÉE si expirée (12 h,
    // non renouvelable). En échec : sync dégradée sans crash, rejeu plus tard.
    await ensureKioskSession();

    let syncedCount = 0;
    let skippedCount = 0;

    for (const batch of chunk(pending, MAX_SYNC_BATCH)) {
      const { syncedLocalUuids, skippedCount: batchSkipped } =
        await syncBatch(batch);
      if (syncedLocalUuids.length > 0) {
        await db.tickets.bulkDelete(syncedLocalUuids);
      }
      syncedCount += syncedLocalUuids.length;
      skippedCount += batchSkipped;
    }

    return { syncedCount, skippedCount };
  };

  return { createOfflineTicket, syncPendingTickets };
}
