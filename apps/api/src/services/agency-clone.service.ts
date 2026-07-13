/**
 * Clonage STRUCTUREL d'agence + provisioning borne — ADM-002a (CONTRACT-013).
 *
 * ## Clonage structurel UNIQUEMENT (garde tenant-isolation)
 * `cloneAgencyStructure` crée une NOUVELLE agence dans le tenant courant et y
 * recopie la CONFIGURATION métier de la source (template ou agence existante) :
 * services actifs (code/nom/SLA/ordre), guichets (statut CLOSED, sans agent), leurs
 * liaisons `counter_services`, et l'horaire hebdomadaire. **JAMAIS** de tickets,
 * files, users/agents, ni aucune PII : le clonage ne touche que des tables de
 * configuration. Le `--brand`/thème est hérité du tenant (ADM-001), pas cloné.
 *
 * Toute lecture/écriture DB passe par `withArmedTenant` (contexte RLS
 * `app.current_bank_id`) → routeur classé **ARMED**. La source d'un autre tenant
 * est invisible sous RLS armée (et filtrée par `bank_id`) → 404 opaque.
 *
 * @module
 */

import type { Client } from "pg";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import { SigfaError } from "src/lib/errors.js";
import { withArmedTenant, asArmable } from "src/lib/armed-tenant.js";

/** Coût bcrypt des credentials borne (aligné DB-008 / kiosk-session). */
const BCRYPT_COST = 12;

/** Résultat du clonage structurel : l'agence créée. */
export interface ClonedAgency {
  /** Identifiant de la nouvelle agence. */
  agencyId: string;
  /** Horodatage de création (ISO). */
  createdAt: string;
}

/** Ligne service projetée pour le clonage (config seule, zéro PII). */
interface ServiceRow {
  id: string;
  code: string;
  name: string;
  sla_minutes: number;
  display_order: number;
}

/** Ligne guichet projetée pour le clonage (config seule). */
interface CounterRow {
  id: string;
  number: number;
  label: string;
}

/** Paramètres du clonage structurel d'agence. */
export interface CloneAgencyParams {
  /** Connexion PG (tenant courant). */
  db: Client;
  /** Banque propriétaire (garde tenant). */
  bankId: string;
  /** Nom de la nouvelle agence. */
  name: string;
  /** Source de clonage : template OU agence existante (déjà validée : exactement une). */
  sourceId: string;
}

/**
 * Vérifie qu'une agence source existe DANS le tenant (armé), ou 404 opaque.
 *
 * @param db     - Connexion armée
 * @param bankId - Banque
 * @param id     - Agence source
 */
async function assertSourceInTenant(
  db: Client,
  bankId: string,
  id: string
): Promise<void> {
  const res = await db.query(
    `SELECT 1 FROM agencies WHERE id = $1 AND bank_id = $2 AND deleted_at IS NULL`,
    [id, bankId]
  );
  if (res.rows.length === 0) {
    // Source hors tenant ou inexistante : 404 OPAQUE (anti-énumération cross-tenant).
    throw new SigfaError("NOT_FOUND", "Agence source introuvable.", 404);
  }
}

/**
 * Clone la STRUCTURE d'une agence source vers une nouvelle agence (zéro PII).
 * Toute la séquence s'exécute dans UNE transaction armée (atomique + RLS).
 *
 * @param params - Connexion, banque, nom, source
 * @returns Agence créée (id + createdAt)
 * @throws {SigfaError} 404 opaque si la source est hors tenant/inexistante
 */
export async function cloneAgencyStructure(
  params: CloneAgencyParams
): Promise<ClonedAgency> {
  const { db, bankId, name, sourceId } = params;
  return withArmedTenant(asArmable(db), bankId, async (conn) => {
    const armed = conn as unknown as Client;
    await assertSourceInTenant(armed, bankId, sourceId);
    const created = await createAgency(armed, bankId, name, sourceId);
    const serviceMap = await cloneServices(armed, bankId, sourceId, created.agencyId);
    await cloneCounters(armed, bankId, sourceId, created.agencyId, serviceMap);
    return created;
  });
}

/** Crée l'agence cible en héritant l'horaire hebdo de la source (config, pas PII). */
async function createAgency(
  db: Client,
  bankId: string,
  name: string,
  sourceId: string
): Promise<ClonedAgency> {
  const res = await db.query(
    `INSERT INTO agencies (bank_id, name, timezone, weekly_schedule)
     SELECT $2, $3, src.timezone, src.weekly_schedule
       FROM agencies src
      WHERE src.id = $1 AND src.bank_id = $2
     RETURNING id, created_at`,
    [sourceId, bankId, name]
  );
  const row = res.rows[0] as { id: string; created_at: Date } | undefined;
  if (!row) {
    throw new SigfaError("NOT_FOUND", "Agence source introuvable.", 404);
  }
  return { agencyId: row.id, createdAt: row.created_at.toISOString() };
}

/**
 * Copie les services ACTIFS source → cible (config : code/nom/SLA/ordre).
 * Retourne la correspondance `serviceId source → serviceId cible` pour les liaisons.
 */
async function cloneServices(
  db: Client,
  bankId: string,
  sourceId: string,
  targetId: string
): Promise<Map<string, string>> {
  const res = await db.query(
    `SELECT id, code, name, sla_minutes, display_order
       FROM services
      WHERE bank_id = $1 AND agency_id = $2 AND deleted_at IS NULL AND is_active = true
      ORDER BY display_order ASC`,
    [bankId, sourceId]
  );
  const map = new Map<string, string>();
  for (const svc of res.rows as ServiceRow[]) {
    const inserted = await db.query(
      `INSERT INTO services (bank_id, agency_id, code, name, sla_minutes, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [bankId, targetId, svc.code, svc.name, svc.sla_minutes, svc.display_order]
    );
    map.set(svc.id, (inserted.rows[0] as { id: string }).id);
  }
  return map;
}

/** Copie les guichets source → cible (CLOSED, sans agent/ticket) + counter_services. */
async function cloneCounters(
  db: Client,
  bankId: string,
  sourceId: string,
  targetId: string,
  serviceMap: Map<string, string>
): Promise<void> {
  const counters = await db.query(
    `SELECT id, number, label FROM counters
      WHERE bank_id = $1 AND agency_id = $2 ORDER BY number ASC`,
    [bankId, sourceId]
  );
  for (const counter of counters.rows as CounterRow[]) {
    const inserted = await db.query(
      `INSERT INTO counters (bank_id, agency_id, number, label, status)
       VALUES ($1, $2, $3, $4, 'CLOSED')
       RETURNING id`,
      [bankId, targetId, counter.number, counter.label]
    );
    const targetCounterId = (inserted.rows[0] as { id: string }).id;
    await cloneCounterServices(db, bankId, counter.id, targetCounterId, serviceMap);
  }
}

/** Recopie les liaisons counter_services (remap serviceId source → cible). */
async function cloneCounterServices(
  db: Client,
  bankId: string,
  srcCounterId: string,
  dstCounterId: string,
  serviceMap: Map<string, string>
): Promise<void> {
  const links = await db.query(
    `SELECT service_id FROM counter_services WHERE bank_id = $1 AND counter_id = $2`,
    [bankId, srcCounterId]
  );
  for (const link of links.rows as Array<{ service_id: string }>) {
    const targetServiceId = serviceMap.get(link.service_id);
    if (!targetServiceId) continue;
    await db.query(
      `INSERT INTO counter_services (bank_id, counter_id, service_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (counter_id, service_id) DO NOTHING`,
      [bankId, dstCounterId, targetServiceId]
    );
  }
}

/** Résultat du provisioning d'une borne (ligne créée). */
export interface ProvisionedKiosk {
  /** Identifiant de la borne provisionnée. */
  kioskId: string;
}

/** Paramètres du provisioning de borne. */
export interface ProvisionKioskParams {
  /** Connexion PG (tenant courant). */
  db: Client;
  /** Banque propriétaire. */
  bankId: string;
  /** Agence propriétaire. */
  agencyId: string;
}

/**
 * Provisionne une borne (armé) : crée la ligne `kiosks` avec un hash de credentials
 * placeholder (les VRAIS credentials sont émis à l'échange du jeton d'enrôlement).
 * La borne existe donc dès le provisioning, mais n'est utilisable qu'après enrôlement.
 *
 * @param params - Connexion, banque, agence
 * @returns Borne créée (kioskId)
 * @throws {SigfaError} 404 opaque si l'agence est hors tenant
 */
export async function provisionKiosk(
  params: ProvisionKioskParams
): Promise<ProvisionedKiosk> {
  const { db, bankId, agencyId } = params;
  return withArmedTenant(asArmable(db), bankId, async (conn) => {
    const armed = conn as unknown as Client;
    const agency = await armed.query(
      `SELECT 1 FROM agencies WHERE id = $1 AND bank_id = $2 AND deleted_at IS NULL`,
      [agencyId, bankId]
    );
    if (agency.rows.length === 0) {
      throw new SigfaError("NOT_FOUND", "Agence introuvable.", 404);
    }
    // Placeholder non-devinable : la borne n'est pas authentifiable tant qu'elle
    // n'a pas échangé son jeton d'enrôlement contre des credentials réels.
    const placeholder = await bcrypt.hash(
      `pending_${nanoid(8)}_${randomBytes(18).toString("base64url")}`,
      BCRYPT_COST
    );
    const res = await armed.query(
      `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash)
       VALUES ($1, $2, 'Borne (enrôlement en attente)', $3)
       RETURNING id`,
      [bankId, agencyId, placeholder]
    );
    return { kioskId: (res.rows[0] as { id: string }).id };
  });
}
