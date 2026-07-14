/**
 * Service session d'affichage TV public — CONTRACT-013 (public.yaml).
 *
 * Émet un **token d'affichage TV public** à privilèges MINIMAUX : un JWT
 * `role: "DISPLAY"` (constante `TV_DISPLAY_ROLE`), **scope une seule agence**,
 * TTL **12 h (43200 s, `TV_SESSION_TTL_SECONDS`)**, **non renouvelable** (aucun
 * refresh, aucun endpoint refresh pour DISPLAY). Ce token n'autorise QUE la
 * réception des flux d'affichage (`sync:state`, `ticket:called`, `queue:updated`)
 * dans la room `agency:{agencyId}` de son propre claim — aucune mutation HTTP,
 * aucune room autre que la sienne, aucun accès aux PII.
 *
 * Contrairement à la session borne (`kiosk-session.service.ts`), aucun secret
 * n'est requis : les données TV (numéros d'appel, files, libellés de comptoir)
 * ne sont PAS des PII. La seule garde est l'existence de l'agence — sinon **404
 * opaque** (`AGENCY_NOT_FOUND`) anti-énumération, sans divulguer l'existence.
 *
 * ## Armement RLS (SEC-002-CUTOVER-LOT7)
 * Le tenant (bankId) d'une session TV n'est PAS porté par une auth staff : il est
 * RÉSOLU depuis l'`agencyId` revendiqué (token de session publique). La résolution
 * initiale — trouver la banque d'une agence dont on IGNORE encore le tenant — est
 * INTRINSÈQUEMENT PRÉ-TENANT (on ne peut pas armer `app.current_bank_id` avant de
 * connaître la banque). Elle s'exécute donc hors armement (lookup d'identité de
 * session). UNE FOIS le bankId dérivé, la confirmation d'existence de l'agence DANS
 * le tenant est REJOUÉE à travers `withArmedTenant(bankId, …)` (RLS `agencies`
 * contraignante) : une session ne peut confirmer QUE des agences de SA banque —
 * défense-en-profondeur au-delà du seul `WHERE id`.
 *
 * @module
 */

import { SignJWT } from "jose";
import type { Client } from "pg";
import { TV_SESSION_TTL_SECONDS, TV_DISPLAY_ROLE } from "@sigfa/contracts/events/realtime.js";
import { SigfaError } from "src/lib/errors.js";
import { type ArmableConnection } from "src/lib/armed-tenant.js";

/** Paramètres de création d'une session TV. */
export interface CreateTvSessionParams {
  /** Connexion PG (résolution pré-tenant du bankId de l'agence). */
  db: Client;
  /** Secret JWT (bytes). */
  jwtSecret: Uint8Array;
  /** Agence revendiquée par l'écran TV. */
  agencyId: string;
  /** Fabrique d'exécution ARMÉE (SEC-002) fournie par la route — confirmation tenant. */
  armedRead: ArmedRead;
}

/** Résultat d'une création de session TV (LA LOI `TvSessionResponse`). */
export interface TvSession {
  /** JWT DISPLAY — lecture seule, scope agency, TTL 12 h, non renouvelable. */
  accessToken: string;
  /** TTL en secondes (toujours 43200). */
  expiresIn: number;
  /** Agence à laquelle le token est scopé (unique). */
  agencyId: string;
  /** Rôle de contrat — constante DISPLAY. */
  role: typeof TV_DISPLAY_ROLE;
}

/** Ligne agence projetée pour la dérivation du bankId. */
interface AgencyBankRow {
  bank_id: string;
}

/**
 * Crée une session d'affichage TV : vérifie l'existence de l'agence (404 opaque
 * sinon), dérive le `bankId` (pour le scope tenant socket) et signe un JWT DISPLAY
 * MINIMAL, TTL 12 h non renouvelable.
 *
 * @param params - Connexion, secret JWT, agence
 * @returns Session (accessToken 12 h + métadonnées)
 * @throws {SigfaError} 404 AGENCY_NOT_FOUND si l'agence n'existe pas (opaque)
 */
export async function createTvSession(params: CreateTvSessionParams): Promise<TvSession> {
  const { db, jwtSecret, agencyId, armedRead } = params;
  // Étape 1 (PRÉ-TENANT) : résoudre la banque de l'agence revendiquée. On ignore
  // encore le tenant — impossible d'armer `app.current_bank_id` à ce stade.
  const bankId = await resolveAgencyBankId(db, agencyId);
  // Étape 2 (ARMÉE) : confirmer l'agence DANS le tenant résolu (RLS contraignante).
  // La fabrique `armedRead` est fournie par la route (elle porte `withArmedTenant`).
  await assertAgencyInArmedTenant(armedRead, bankId, agencyId);
  const accessToken = await signTvToken(jwtSecret, agencyId, bankId);
  return {
    accessToken,
    expiresIn: TV_SESSION_TTL_SECONDS,
    agencyId,
    role: TV_DISPLAY_ROLE,
  };
}

/**
 * Fabrique d'exécution ARMÉE : la route fournit une fonction qui, pour un `bankId`
 * donné, exécute son corps à travers `withArmedTenant` (`app.current_bank_id`
 * armé, connexion `sigfa_app`). Le service en reste découplé (testable), la source
 * unique d'armement demeure `src/lib/armed-tenant.ts` invoquée dans la route.
 */
export type ArmedRead = <T>(
  bankId: string,
  fn: (conn: ArmableConnection) => Promise<T>
) => Promise<T>;

/**
 * Dérive le `bankId` d'une agence existante et active. Une agence inconnue,
 * supprimée ou inactive → **404 opaque** `AGENCY_NOT_FOUND` (anti-énumération :
 * même corps d'erreur, ne jamais divulguer l'existence).
 *
 * SEC-002 : lookup INTRINSÈQUEMENT PRÉ-TENANT (résolution d'identité de session :
 * on cherche la banque d'une agence dont le tenant est encore inconnu). Il ne peut
 * pas être armé — c'est la seule étape légitimement hors `withArmedTenant`.
 *
 * @param db       - Connexion PG
 * @param agencyId - Agence revendiquée
 * @returns bankId de l'agence
 * @throws {SigfaError} 404 AGENCY_NOT_FOUND si absente/inactive
 */
async function resolveAgencyBankId(db: Client, agencyId: string): Promise<string> {
  const res = await db.query(
    `SELECT bank_id FROM agencies
      WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
    [agencyId]
  );
  const row = res.rows[0] as AgencyBankRow | undefined;
  if (!row) {
    throw new SigfaError("AGENCY_NOT_FOUND", "Agence introuvable.", 404);
  }
  return row.bank_id;
}

/**
 * Confirme, SOUS ARMEMENT (`app.current_bank_id = bankId`), que l'agence existe,
 * est active et appartient bien au tenant résolu. Sous RLS FORCE (`sigfa_app`
 * NOBYPASSRLS), la policy `tenant_isolation` de `agencies` borne la lecture à la
 * banque armée : une session ne peut confirmer QUE ses propres agences. Toute
 * incohérence (agence hors tenant / inactive) → **404 opaque** identique.
 *
 * @param armedRead - Fabrique d'exécution armée (portée par la route)
 * @param bankId    - Banque résolue (armement RLS)
 * @param agencyId  - Agence revendiquée
 * @throws {SigfaError} 404 AGENCY_NOT_FOUND si l'agence n'est pas confirmée armée
 */
async function assertAgencyInArmedTenant(
  armedRead: ArmedRead,
  bankId: string,
  agencyId: string
): Promise<void> {
  const confirmed = await armedRead(bankId, async (conn) => {
    const res = await conn.query(
      `SELECT id FROM agencies
        WHERE id = $1 AND is_active = true AND deleted_at IS NULL`,
      [agencyId]
    );
    return res.rows.length > 0;
  });
  if (!confirmed) {
    throw new SigfaError("AGENCY_NOT_FOUND", "Agence introuvable.", 404);
  }
}

/**
 * Signe le JWT d'affichage TV : claims MINIMAUX (`role: DISPLAY`, scope une seule
 * agence, `bankId` dérivé pour le scope tenant socket, `sub` = identifiant
 * d'affichage stable `tv:{agencyId}`), TTL 12 h. Non renouvelable : aucun claim
 * de session ni de refresh.
 *
 * @param secret   - Secret JWT (bytes)
 * @param agencyId - Agence scopée (unique)
 * @param bankId   - Banque dérivée (scope tenant socket)
 * @returns JWT DISPLAY signé
 */
async function signTvToken(
  secret: Uint8Array,
  agencyId: string,
  bankId: string
): Promise<string> {
  return new SignJWT({
    bankId,
    role: TV_DISPLAY_ROLE,
    agencyIds: [agencyId],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`tv:${agencyId}`)
    .setIssuedAt()
    .setExpirationTime(`${TV_SESSION_TTL_SECONDS}s`)
    .sign(secret);
}
