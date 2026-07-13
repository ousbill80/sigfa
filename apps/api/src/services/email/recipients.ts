/**
 * recipients — résolution des destinataires INTERNES d'un email par rôle/agence
 * (NOTIF-004).
 *
 * LA LOI (NOTIF-004) :
 *  - Le canal email n'adresse QUE des utilisateurs internes (staff de la banque),
 *    JAMAIS un client final. Aucune adresse email de client n'est lue.
 *  - **Aucun opt-in UEMOA** : le régime de consentement SMS/WhatsApp ne s'applique
 *    pas aux destinataires internes (RBAC via API-008 / rôle).
 *  - Résolution SOUS garde tenant D5 : `withTenant(bank_id)` — le `bank_id` du job
 *    est la source de vérité ; la RLS applicative garantit qu'on ne lit jamais les
 *    utilisateurs d'une autre banque.
 *  - MANAGER_ALERT → managers/directeurs de l'AGENCE concernée. Rapports → rôles
 *    d'abonnement (managers/directeurs/admin) au niveau banque (ou agence si fournie).
 *  - Liste vide résolue ⇒ le producteur échoue proprement `NO_RECIPIENT` (aucun envoi).
 *
 * @module
 */

import type { QueryFn } from "@sigfa/database";
import { withTenant } from "@sigfa/database";

/** Rôles internes destinataires par défaut d'une alerte manager (agence). */
export const MANAGER_ALERT_ROLES = ["MANAGER", "AGENCY_DIRECTOR"] as const;

/** Rôles internes abonnés aux rapports (niveau banque/agence). */
export const REPORT_ROLES = ["MANAGER", "AGENCY_DIRECTOR", "BANK_ADMIN"] as const;

/** Portée de résolution des destinataires. */
export interface RecipientQuery {
  /** Tenant — banque (source de vérité D5). */
  bankId: string;
  /** Rôles internes ciblés (RBAC — API-008). */
  roles: readonly string[];
  /**
   * Agence de contexte (MANAGER_ALERT). Si fourni, restreint aux utilisateurs
   * affectés à cette agence (via `agency_users`). Si `null`, portée banque.
   */
  agencyId?: string | null;
}

/** Erreur : aucun destinataire interne résolu (échec propre, aucun envoi). */
export class NoRecipientError extends Error {
  constructor(query: RecipientQuery) {
    super(
      `NO_RECIPIENT : aucun destinataire interne pour bank=${query.bankId} roles=${query.roles.join(",")}${
        query.agencyId ? ` agency=${query.agencyId}` : ""
      }`
    );
    this.name = "NoRecipientError";
  }
}

/** Échappe une valeur pour une liste SQL `IN (...)` (rôles = valeurs contrôlées). */
function sqlStringList(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}

/**
 * Résout les adresses email internes ciblées, SOUS garde tenant D5.
 *
 * - Filtre : `is_active AND deleted_at IS NULL AND email non nul`, rôle ∈ `roles`.
 * - Si `agencyId` fourni : jointure `agency_users` (utilisateurs de l'agence).
 * - Dédoublonne + trie (déterminisme) les adresses.
 *
 * @param queryFn - Requête SQL applicative (connexion sigfa_app, hors RLS session)
 * @param query   - Portée (bank, roles, agency)
 * @returns Adresses email internes distinctes et triées (jamais un client final)
 */
export async function resolveInternalRecipients(
  queryFn: QueryFn,
  query: RecipientQuery
): Promise<string[]> {
  if (query.roles.length === 0) return [];

  return withTenant(queryFn, query.bankId, async (q) => {
    const roleList = sqlStringList(query.roles);
    // Garde tenant EXPLICITE (`bank_id = query.bankId`) EN PLUS de la RLS (D5) :
    // tient même si la connexion applicative bypassait la RLS (rôle owner en test).
    const agencyJoin = query.agencyId
      ? `JOIN agency_users au ON au.user_id = u.id
           AND au.bank_id = '${query.bankId}'
           AND au.agency_id = '${query.agencyId}'`
      : "";
    const res = await q(
      `SELECT DISTINCT u.email
         FROM users u
         ${agencyJoin}
        WHERE u.bank_id = '${query.bankId}'
          AND u.role IN (${roleList})
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND u.email IS NOT NULL
        ORDER BY u.email`
    );
    return res.rows.map((r) => (r as { email: string }).email);
  });
}

/**
 * Résout les destinataires ou lève `NoRecipientError` si la liste est vide —
 * garantit qu'aucun email n'est enfilé sans destinataire (LA LOI).
 *
 * @param queryFn - Requête SQL applicative
 * @param query   - Portée de résolution
 * @returns Adresses email internes non vides
 * @throws {NoRecipientError} Si aucune adresse n'est résolue
 */
export async function requireInternalRecipients(
  queryFn: QueryFn,
  query: RecipientQuery
): Promise<string[]> {
  const recipients = await resolveInternalRecipients(queryFn, query);
  if (recipients.length === 0) {
    throw new NoRecipientError(query);
  }
  return recipients;
}
