/**
 * Isolation d'état inter-specs E2E (E2E-STATE-ISOLATION).
 *
 * Le harnais E2E tourne contre UN backend réel unique à base MUTABLE
 * (Testcontainers PG16/Redis7 + API réelle, cf. `harness.ts`). Le seed initial
 * est écrit UNE FOIS au `global-setup` ; les specs s'exécutent ensuite en série
 * pendant plusieurs minutes contre CET état partagé. Sans reset ciblé, deux
 * sources de dérive rendent la suite ORDRE-DÉPENDANTE :
 *
 *  1. **File FIFO** — `call-next` (dashboard agent) appelle le PLUS ANCIEN ticket
 *     `WAITING` de l'agence, jamais forcément celui que le spec vient d'émettre.
 *     Un spec qui laisse un ticket `WAITING` derrière lui (ex. `audit-trail`
 *     émet sans appeler) fait dériver le spec suivant : son `call-next` sert le
 *     ticket fantôme, et l'assertion `agent-ticket-number ⊇ digits(sonTicket)`
 *     échoue (`journey`, `network-cut`). L'écran TV, dérivé du dernier `CALLED`
 *     en base, affiche alors un numéro étranger.
 *
 *  2. **Fraîcheur borne** — le statut d'une borne est DÉRIVÉ À LA LECTURE depuis
 *     `last_seen` + l'horloge serveur (ONLINE < 60 s, DEGRADED ≥ 60 s, SILENT
 *     ≥ 90 s). Le seed pose la borne « en ligne » à `now() - 5 s` UNE FOIS ; mais
 *     la suite dure plusieurs minutes, si bien qu'au moment où `kiosk-supervision`
 *     s'exécute cette borne a > 90 s de silence et n'est plus ONLINE — l'assertion
 *     `kiosk-card[data-status="ONLINE"]` trouve 0 élément.
 *
 * Ce module fournit des resets CIBLÉS (jamais une re-migration coûteuse) que les
 * specs concernés appellent dans un `beforeAll` : chaque spec démarre d'un état
 * connu, indépendant de l'ordre d'exécution.
 *
 * On accède à PostgreSQL en OWNER (superuser du conteneur E2E → BYPASSRLS,
 * comme le seed) via l'URL exposée dans l'état (`dbUrl`). Playwright charge ce
 * module en CJS → `require("pg")` fonctionne dans le worker.
 *
 * @module e2e/support/reset
 */
import pg from "pg";
import type { E2eState } from "./state";

/** Ouvre une connexion owner éphémère, exécute `fn`, puis referme. */
async function withDb<T>(state: E2eState, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: state.dbUrl });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/**
 * Remet la FILE de l'agence seedée à un état vierge et déterministe :
 *   - purge tous les tickets de l'agence (WAITING/CALLED/DONE/…) + leurs
 *     transferts (dépendance FK) → plus aucun ticket fantôme dans la file ni
 *     dans le dernier `CALLED` (source du héros TV) ;
 *   - remet `queues.current_ticket_number` à 0 → la numérotation repart de 1
 *     pour ce spec (les assertions restent relatives au numéro émis, mais un
 *     compteur borné garde les traces lisibles) ;
 *   - rouvre le guichet seedé (OPEN) réaffecté à l'agent, et repose l'agent en
 *     AVAILABLE → `call-next` est immédiatement opérationnel.
 *
 * Idempotent : sûr à appeler avant CHAQUE spec pilotant la file.
 */
export async function resetQueueState(state: E2eState): Promise<void> {
  await withDb(state, async (db) => {
    // Transferts d'abord (FK vers tickets), puis les tickets de l'agence.
    await db.query(`DELETE FROM ticket_transfers WHERE bank_id = $1`, [state.bankId]);
    await db.query(`DELETE FROM tickets WHERE agency_id = $1`, [state.agencyId]);
    // Compteur de file remis à zéro (numérotation déterministe par spec).
    await db.query(
      `UPDATE queues SET current_ticket_number = 0 WHERE id = $1`,
      [state.queueId],
    );
    // Guichet seedé rouvert et réaffecté à l'agent (call-next opérationnel).
    await db.query(
      `UPDATE counters SET status = 'OPEN', agent_id = $1 WHERE id = $2`,
      [state.agentId, state.counterId],
    );
    // Agent repositionné AVAILABLE (le cycle ticket pilotera SERVING/AVAILABLE).
    await db.query(
      `INSERT INTO agent_status_history (bank_id, agency_id, agent_id, to_status)
       VALUES ($1, $2, $3, 'AVAILABLE')`,
      [state.bankId, state.agencyId, state.agentId],
    );
  });
}

/**
 * Rafraîchit les horodatages `last_seen` des DEUX bornes de supervision seedées
 * pour que leur statut DÉRIVÉ soit déterministe AU MOMENT du spec, quel que soit
 * le temps écoulé depuis le seed :
 *   - borne EN LIGNE → `now() - 5 s`  (statut ONLINE, silence < 60 s) ;
 *   - borne MUETTE    → `now() - 10 min` (statut SILENT, silence ≥ 90 s).
 *
 * On re-stampe juste avant l'exécution du spec `kiosk-supervision`, éliminant la
 * dérive temporelle (la borne « en ligne » vieillissait au fil de la suite et
 * finissait DEGRADED/SILENT).
 */
export async function refreshKioskHeartbeats(state: E2eState): Promise<void> {
  await withDb(state, async (db) => {
    await db.query(
      `UPDATE kiosks SET last_seen = now() - interval '5 seconds' WHERE id = $1`,
      [state.onlineKioskId],
    );
    await db.query(
      `UPDATE kiosks SET last_seen = now() - interval '10 minutes' WHERE id = $1`,
      [state.silentKioskId],
    );
  });
}
