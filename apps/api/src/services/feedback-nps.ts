/**
 * Agrégation NPS incrémentale idempotente PAR TICKET (API-010).
 *
 * ## Mapping NPS (convention SIGFA — voir schéma `daily_agency_stats`)
 * - note 5      → promoter  (`nps_promoters`)
 * - note 4      → passive   (`nps_passives`)
 * - note ≤ 3    → detractor (`nps_detractors`)
 *
 * ## Idempotence par ticket
 * L'appel N'incrémente QU'UNE FOIS par ticket : la route ne persiste le feedback
 * (et n'appelle ce service) qu'à la PREMIÈRE soumission (UPDATE conditionnel
 * `WHERE feedback_score IS NULL`). Un rejeu est rejeté en amont (409) → aucun
 * double comptage. Cette fonction n'a donc pas à dédupliquer elle-même.
 *
 * ## Upsert incrémental
 * Insère la ligne d'agrégat du jour (toutes-services `service_id IS NULL`) si
 * absente, sinon incrémente `+1` le bucket concerné + `feedback_count` +
 * `feedback_sum`. Les index uniques partiels de `daily_agency_stats` garantissent
 * l'unicité de la ligne.
 *
 * Le jour de l'agrégat est calculé en timezone Africa/Abidjan, aligné sur
 * `tickets.issued_day` et l'agrégat de reporting (DB-006 / REP-001).
 *
 * @module
 */

import type { Client } from "pg";

/** Colonne NPS incrémentée pour une note donnée. */
export type NpsBucket = "nps_promoters" | "nps_passives" | "nps_detractors";

/**
 * Résout le bucket NPS d'une note (LA LOI : 1–5 entière).
 *
 * @param note - Note de satisfaction (1–5)
 * @returns Colonne d'agrégat à incrémenter
 */
export function npsBucket(note: number): NpsBucket {
  if (note >= 5) return "nps_promoters";
  if (note === 4) return "nps_passives";
  return "nps_detractors";
}

/** Contexte d'un feedback pour l'agrégation. */
export interface FeedbackAggregateInput {
  /** Banque (tenant). */
  bankId: string;
  /** Agence du ticket. */
  agencyId: string;
  /** Service du ticket. */
  serviceId: string;
  /** Note 1–5. */
  note: number;
  /** Horodatage de clôture (ancre le jour d'agrégat en timezone Abidjan). */
  closedAt: Date;
}

/**
 * Incrémente les compteurs NPS du jour pour l'agrégat toutes-services ET
 * l'agrégat par service (upsert incrémental idempotent par ticket).
 *
 * @param db    - Connexion PG (transaction courante recommandée)
 * @param input - Contexte du feedback
 */
export async function incrementDailyNps(db: Client, input: FeedbackAggregateInput): Promise<void> {
  const bucket = npsBucket(input.note);
  await upsertAggregate(db, input, null, bucket);
  await upsertAggregate(db, input, input.serviceId, bucket);
}

/**
 * Upsert d'une ligne d'agrégat (service_id null ou renseigné) : +1 bucket,
 * +1 feedback_count, +note feedback_sum. La colonne bucket est injectée depuis
 * une liste blanche fermée (`NpsBucket`) — aucune valeur utilisateur en SQL.
 *
 * @param db        - Connexion PG
 * @param input     - Contexte du feedback
 * @param serviceId - Service ciblé, ou `null` pour l'agrégat toutes-services
 * @param bucket    - Colonne NPS à incrémenter (liste blanche)
 */
async function upsertAggregate(
  db: Client,
  input: FeedbackAggregateInput,
  serviceId: string | null,
  bucket: NpsBucket
): Promise<void> {
  const conflictTarget = serviceId === null ? "(bank_id, agency_id, day) WHERE service_id IS NULL" : "(bank_id, agency_id, service_id, day) WHERE service_id IS NOT NULL";
  await db.query(
    `INSERT INTO daily_agency_stats
       (bank_id, agency_id, service_id, day, feedback_count, feedback_sum, ${bucket}, updated_at)
     VALUES ($1, $2, $3, ($4 AT TIME ZONE 'Africa/Abidjan')::date, 1, $5, 1, now())
     ON CONFLICT ${conflictTarget}
     DO UPDATE SET
       feedback_count = daily_agency_stats.feedback_count + 1,
       feedback_sum   = daily_agency_stats.feedback_sum + $5,
       ${bucket}      = daily_agency_stats.${bucket} + 1,
       updated_at     = now()`,
    [input.bankId, input.agencyId, serviceId, input.closedAt, input.note]
  );
}
