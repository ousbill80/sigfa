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
 * @module
 */

import { SignJWT } from "jose";
import type { Client } from "pg";
import { TV_SESSION_TTL_SECONDS, TV_DISPLAY_ROLE } from "@sigfa/contracts/events/realtime.js";
import { SigfaError } from "src/lib/errors.js";

/** Paramètres de création d'une session TV. */
export interface CreateTvSessionParams {
  /** Connexion PG. */
  db: Client;
  /** Secret JWT (bytes). */
  jwtSecret: Uint8Array;
  /** Agence revendiquée par l'écran TV. */
  agencyId: string;
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
  const { db, jwtSecret, agencyId } = params;
  const bankId = await resolveAgencyBankId(db, agencyId);
  const accessToken = await signTvToken(jwtSecret, agencyId, bankId);
  return {
    accessToken,
    expiresIn: TV_SESSION_TTL_SECONDS,
    agencyId,
    role: TV_DISPLAY_ROLE,
  };
}

/**
 * Dérive le `bankId` d'une agence existante et active. Une agence inconnue,
 * supprimée ou inactive → **404 opaque** `AGENCY_NOT_FOUND` (anti-énumération :
 * même corps d'erreur, ne jamais divulguer l'existence).
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
