/**
 * Contexte d'audit applicatif — API-008 (SEC-001 anticipé).
 *
 * Chaque mutation du périmètre admin (banques, agences, services, guichets,
 * files, horaires, seuils, templates SMS, profils agents) écrit une entrée
 * `audit_log` via `insertAuditEntry` de `@sigfa/database` : qui (acteur+rôle+email),
 * quoi (action + entité + diff avant/après), IP.
 *
 * `insertAuditEntry` attend une `QueryFn` `(sql) => Promise<{ rows }>` : on adapte
 * `pg.Client` (dont `query(sql)` accepte une seule chaîne SQL sans paramètres).
 *
 * @module
 */

import type { Client } from "pg";
import type { Context } from "hono";
import {
  insertAuditEntry,
  type ActorRole,
  type AuditEntryRow,
} from "@sigfa/database";
import type { TenantContext } from "src/middleware/tenant.js";
import { resolveClientIp } from "src/lib/client-ip.js";

/** Rôles RBAC persistés en base (LA LOI `Role` \ {NONE}, sans sentinelles). */
const PERSISTED_ROLES: ReadonlySet<string> = new Set([
  "SUPER_ADMIN",
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
]);

/**
 * Convertit le rôle du contexte tenant en `ActorRole` de l'audit, ou `null`
 * si le rôle est une sentinelle (jamais persistée).
 *
 * @param role - Rôle du JWT
 * @returns Rôle persistable ou null
 */
export function toActorRole(role: string): ActorRole | null {
  return PERSISTED_ROLES.has(role) ? (role as ActorRole) : null;
}

/**
 * Extrait l'adresse IP de l'appelant pour l'audit, ou `null`.
 * Délègue à `resolveClientIp` : `X-Forwarded-For`/`X-Real-IP` ne sont pris en
 * compte que si `TRUST_PROXY` est activé (défaut `false`) — sinon l'IP de
 * connexion réelle est utilisée. Empêche la falsification de l'IP d'audit via un
 * en-tête `X-Forwarded-For` forgé (Boucle 3 F3). `null` si indéterminable.
 *
 * @param c - Contexte Hono de la requête
 * @returns Adresse IP ou null
 */
export function extractIp(c: Context): string | null {
  const ip = resolveClientIp(c);
  return ip === "unknown" ? null : ip;
}

/** Paramètres d'écriture d'une entrée d'audit de mutation. */
export interface AuditMutationParams {
  /** Connexion applicative PG (scope tenant courant). */
  db: Client;
  /** Contexte tenant (acteur, rôle, banque). */
  tenant: TenantContext;
  /** Action journalisée (ex. « POST /agencies »). */
  action: string;
  /** Type d'entité affectée (ex. « agency »). */
  entityType: string;
  /** Identifiant de l'entité affectée (nullable). */
  entityId?: string | null;
  /** Adresse IP de l'acteur (nullable). */
  ip?: string | null;
  /** Email de l'acteur (dénormalisé), si connu. */
  actorEmail?: string | null;
  /** Diff avant/après de la mutation. */
  diff?: Record<string, unknown> | null;
}

/**
 * Écrit une entrée d'audit pour une mutation du périmètre admin.
 * Doit être appelée dans le contexte tenant courant (RLS `bank_id`).
 *
 * @param params - Paramètres de l'entrée d'audit
 * @returns La ligne `audit_log` insérée
 */
export async function recordAudit(
  params: AuditMutationParams
): Promise<AuditEntryRow> {
  const queryFn = (
    sql: string
  ): Promise<{ rows: Record<string, unknown>[] }> =>
    params.db.query(sql) as unknown as Promise<{
      rows: Record<string, unknown>[];
    }>;
  return insertAuditEntry(queryFn, {
    bankId: params.tenant.bankId ?? "",
    actorId: params.tenant.userId || null,
    actorRole: toActorRole(params.tenant.role),
    actorEmail: params.actorEmail ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    ip: params.ip ?? null,
    diff: params.diff ?? null,
  });
}

/**
 * Construit un diff `{ before, after }` en ne conservant que les clés modifiées.
 * `before`/`after` sont des projections des colonnes pertinentes.
 *
 * @param before - État avant mutation
 * @param after  - État après mutation
 * @returns Diff structuré (clés changées uniquement)
 */
export function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (!deepEqual(before[key], after[key])) {
      changedBefore[key] = before[key] ?? null;
      changedAfter[key] = after[key] ?? null;
    }
  }
  return { before: changedBefore, after: changedAfter };
}

/**
 * Égalité structurelle simple (JSON) pour comparer des valeurs de colonnes.
 *
 * @param a - Première valeur
 * @param b - Seconde valeur
 * @returns true si structurellement égales
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
