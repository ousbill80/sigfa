/**
 * `insertAuditEntry` — écriture applicative typée dans `audit_log` (DB-004 / SEC-001).
 *
 * Les mutations applicatives non-DDL (ex. transitions de ticket, exclues des triggers
 * de base — voir décision `tickets`) sont journalisées par l'API via cette fonction,
 * dans la MÊME table immuable que les triggers d'audit.
 *
 * `occurred_at` n'est JAMAIS fourni par l'appelant : la base applique `DEFAULT now()`.
 * La fonction n'accepte donc aucun horodatage — l'horloge reste serveur.
 *
 * @module
 */

import type { QueryResult } from "@sigfa/testing/tenant-isolation";

/**
 * Type d'une fonction de requête SQL (compatible `DualConnectionHarness.appQuery`
 * et du `QueryFn` de `withTenant`). Défini localement pour éviter un import parent
 * (imports absolus depuis `src/` — CLAUDE.md §7).
 */
export type QueryFn = (sql: string) => Promise<QueryResult>;

/** Rôle RBAC de l'acteur (LA LOI `Role` \ {NONE}) — aligné `role` enum. */
export type ActorRole =
  | "SUPER_ADMIN"
  | "BANK_ADMIN"
  | "AGENCY_DIRECTOR"
  | "MANAGER"
  | "AGENT"
  | "AUDITOR";

/**
 * Entrée d'audit applicative à insérer. `occurredAt` est volontairement absent :
 * l'horloge est serveur (`DEFAULT now()`), jamais fournie par le client.
 */
export interface AuditEntryInput {
  /** Tenant — banque propriétaire (doit correspondre au contexte RLS courant). */
  bankId: string;
  /** Acteur ayant provoqué la mutation (optionnel — job/système). */
  actorId?: string | null;
  /** Rôle RBAC de l'acteur au moment de l'action. */
  actorRole?: ActorRole | null;
  /** Email de l'acteur — dénormalisé (l'acteur peut être supprimé). */
  actorEmail?: string | null;
  /** Action journalisée, libre (≤500 caractères) — ex. « PATCH /banks/:id/theme ». */
  action: string;
  /** Type d'entité affectée (ex. « ticket »). */
  entityType: string;
  /** Identifiant de l'entité affectée (optionnel). */
  entityId?: string | null;
  /** Adresse IP de l'acteur (inet), optionnelle. */
  ip?: string | null;
  /** Diff des valeurs (anciennes/nouvelles), optionnel. */
  diff?: Record<string, unknown> | null;
}

/** Ligne `audit_log` telle que relue après insertion. */
export interface AuditEntryRow {
  /** Identifiant unique de l'entrée. */
  id: string;
  /** Tenant. */
  bank_id: string;
  /** Acteur (nullable). */
  actor_id: string | null;
  /** Rôle de l'acteur (nullable). */
  actor_role: ActorRole | null;
  /** Email dénormalisé de l'acteur (nullable). */
  actor_email: string | null;
  /** Action journalisée. */
  action: string;
  /** Type d'entité. */
  entity_type: string;
  /** Identifiant d'entité (nullable). */
  entity_id: string | null;
  /** Horloge serveur. */
  occurred_at: Date;
  /** IP de l'acteur (nullable). */
  ip: string | null;
  /** Diff (nullable). */
  diff: Record<string, unknown> | null;
}

/**
 * Échappe une valeur textuelle SQL (simple protection anti-injection pour ce helper
 * générique sans driver paramétré). Les valeurs proviennent de l'API, jamais du client.
 * @param value - Chaîne à échapper
 * @returns Littéral SQL entre quotes
 */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Rend un littéral SQL pour une valeur nullable optionnelle.
 * @param value - Valeur (string) ou null/undefined
 * @returns `NULL` ou littéral quoté
 */
function nullableText(value: string | null | undefined): string {
  return value === null || value === undefined ? "NULL" : quote(value);
}

/**
 * Insère une entrée d'audit applicative dans `audit_log` et retourne la ligne créée.
 *
 * Doit être appelée dans un contexte tenant (`withTenant`) : la policy RLS impose
 * `bank_id = current_setting('app.current_bank_id')`. `occurred_at` est fixé par la base.
 *
 * @param queryFn - Fonction de requête SQL (connexion applicative sigfa_app)
 * @param entry   - Entrée d'audit à insérer (sans horodatage)
 * @returns La ligne `audit_log` insérée (relecture RETURNING)
 * @throws Si l'INSERT est rejeté (RLS, contrainte) ou la connexion échoue
 */
export async function insertAuditEntry(
  queryFn: QueryFn,
  entry: AuditEntryInput
): Promise<AuditEntryRow> {
  const diffLiteral =
    entry.diff === null || entry.diff === undefined
      ? "NULL"
      : `${quote(JSON.stringify(entry.diff))}::jsonb`;
  const ipLiteral =
    entry.ip === null || entry.ip === undefined ? "NULL" : `${quote(entry.ip)}::inet`;

  const sql = `
    INSERT INTO audit_log
      (bank_id, actor_id, actor_role, actor_email, action, entity_type, entity_id, ip, diff)
    VALUES (
      ${quote(entry.bankId)},
      ${nullableText(entry.actorId)},
      ${entry.actorRole === null || entry.actorRole === undefined ? "NULL" : `${quote(entry.actorRole)}::role`},
      ${nullableText(entry.actorEmail)},
      ${quote(entry.action)},
      ${quote(entry.entityType)},
      ${nullableText(entry.entityId)},
      ${ipLiteral},
      ${diffLiteral}
    )
    RETURNING id, bank_id, actor_id, actor_role, actor_email, action,
              entity_type, entity_id, occurred_at, host(ip) AS ip, diff
  `;

  const result = await queryFn(sql);
  return result.rows[0] as unknown as AuditEntryRow;
}
