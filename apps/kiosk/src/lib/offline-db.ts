/**
 * KIOSK-006 — offline-db.ts
 * Base IndexedDB (Dexie.js) pour la persistance offline-first des tickets.
 *
 * Deux tables :
 *  - `tickets`  : file d'attente des tickets émis hors connexion (à synchroniser).
 *  - `counters` : compteur monotone pour la numérotation locale séquentielle.
 *
 * Aucun fetch ici — la couche réseau (sync via `@sigfa/contracts`) vit dans
 * le hook `useOfflineTicket`. Ce module ne fait QUE de la persistance locale.
 */
import Dexie, { type Table } from "dexie";

/** Préfixe des numéros locaux (H = hors-ligne). */
export const LOCAL_NUMBER_PREFIX = "H";

/** Canal fixe des tickets émis par la borne. */
export const KIOSK_CHANNEL = "KIOSK";

/**
 * Ligne persistée d'un ticket offline.
 * `localUuid` (UUID v4 client) est la clé primaire — garantit l'idempotence unitaire.
 */
export interface OfflineTicketRow {
  /** UUID v4 généré côté client — clé primaire, jamais de doublon. */
  localUuid: string;
  /** Service demandé (référence contrat). */
  serviceId: string;
  /**
   * MODEL-KIOSK-A : opération demandée (additif, optionnel). Le `serviceId`
   * reste stocké (rétrocompat + dérivation serveur). Absent = parcours 1 niveau.
   */
  operationId?: string;
  /** Agence dérivée de la session kiosque. */
  agencyId: string;
  /** Canal d'émission (toujours KIOSK). */
  channel: string;
  /** Numéro séquentiel local (entier monotone). */
  localSequence: number;
  /** Numéro affiché dérivé du séquentiel (ex: H001). */
  displayNumber: string;
  /** Instant d'émission hors connexion (ISO 8601). */
  createdOfflineAt: string;
}

/** Ligne du compteur local (une seule ligne, id="ticket"). */
export interface CounterRow {
  id: string;
  value: number;
}

/** Identifiant unique du compteur de tickets locaux. */
export const TICKET_COUNTER_ID = "ticket";

/**
 * Base Dexie de la borne. Version 1 :
 *  - tickets  : clé primaire `localUuid`, index secondaire `createdOfflineAt`.
 *  - counters : clé primaire `id`.
 */
export class OfflineTicketDatabase extends Dexie {
  tickets!: Table<OfflineTicketRow, string>;
  counters!: Table<CounterRow, string>;

  constructor(name = "sigfa-kiosk-offline") {
    super(name);
    this.version(1).stores({
      tickets: "localUuid, createdOfflineAt",
      counters: "id",
    });
  }
}

/** Singleton de la base (réutilisé entre appels du hook). */
let dbInstance: OfflineTicketDatabase | null = null;

/** Retourne (et crée à la demande) l'instance unique de la base offline. */
export function getOfflineDb(): OfflineTicketDatabase {
  if (dbInstance === null) {
    dbInstance = new OfflineTicketDatabase();
  }
  return dbInstance;
}

/** Réinitialise le singleton — usage tests uniquement. */
export function __resetOfflineDbForTests(): void {
  dbInstance = null;
}

/** Formate un numéro séquentiel en numéro affiché (H + 3 chiffres). */
export function formatLocalNumber(sequence: number): string {
  return `${LOCAL_NUMBER_PREFIX}${String(sequence).padStart(3, "0")}`;
}

/**
 * Incrémente et renvoie le prochain numéro séquentiel local, de manière
 * atomique (transaction Dexie readwrite) — jamais de doublon même en
 * concurrence d'onglets/appels rapprochés.
 */
export async function nextLocalSequence(
  db: OfflineTicketDatabase = getOfflineDb()
): Promise<number> {
  return db.transaction("rw", db.counters, async () => {
    const current = await db.counters.get(TICKET_COUNTER_ID);
    const next = (current?.value ?? 0) + 1;
    await db.counters.put({ id: TICKET_COUNTER_ID, value: next });
    return next;
  });
}
