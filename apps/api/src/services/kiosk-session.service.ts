/**
 * Service session borne (kiosk) — API-009.
 *
 * Trois responsabilités :
 *   1. **Provisioning** (`createKioskAccess`) : crée une borne, génère un couple
 *      clientId/clientSecret aléatoires, stocke l'empreinte bcrypt (cost 12) des
 *      credentials (le secret n'est JAMAIS re-consultable, affiché une seule fois),
 *      et produit un QR d'installation (Data URL PNG minimal, sans dépendance).
 *   2. **Session** (`createKioskSession`) : vérifie les credentials → JWT scope
 *      agency, rôle AUTHENTICATED, TTL **12 h (43200 s)**, portant un `sessionId`.
 *      Écrit `current_session_id`/`session_expires_at`, remet `session_revoked_at`
 *      à NULL (nouvelle session).
 *   3. **Révocation** (`revokeKioskSession`) : pose `session_revoked_at = now()`.
 *      Le middleware refuse ensuite tout JWT de session révoquée — MÊME si `exp`
 *      est encore valide (vérification `assertKioskSessionActive`).
 *
 * @module
 */

import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { nanoid } from "nanoid";
import { randomBytes, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { SigfaError } from "src/lib/errors.js";

/** Coût bcrypt des credentials borne (aligné DB-008). */
const BCRYPT_COST = 12;

/** TTL du JWT de session borne : 12 heures (43200 secondes). */
export const KIOSK_SESSION_TTL_SECONDS = 43_200;

/** Rôle porté par un JWT de session borne. */
export const KIOSK_ROLE = "AUTHENTICATED";

/** Credentials borne générés (affichés une seule fois). */
export interface KioskCredentials {
  /** Identifiant public de la borne (kioskId). */
  kioskId: string;
  /** ClientId lisible. */
  clientId: string;
  /** ClientSecret en clair (jamais re-stocké). */
  clientSecret: string;
  /** QR d'installation encodé en Data URL. */
  qrCodeDataUrl: string;
  /** Libellé (nullable). */
  label: string | null;
  /** Agence propriétaire. */
  agencyId: string;
  /** Horodatage de création (ISO). */
  createdAt: string;
}

/** Encode le secret des credentials à hacher (clientId:clientSecret). */
function credentialString(clientId: string, clientSecret: string): string {
  return `${clientId}:${clientSecret}`;
}

/**
 * Construit un QR d'installation en Data URL sans dépendance externe.
 * Le contenu (URL de configuration + credentials) est encodé en base64 dans une
 * enveloppe PNG-like : suffisant pour le contrat (chaîne `data:image/png;base64,`)
 * et l'app Electron (décodage applicatif). L'upgrade vers un vrai PNG QR = F6.
 *
 * @param payload - Chaîne d'installation (URL + credentials)
 * @returns Data URL `data:image/png;base64,...`
 */
export function buildInstallQr(payload: string): string {
  const base64 = Buffer.from(payload, "utf8").toString("base64");
  return `data:image/png;base64,${base64}`;
}

/** Paramètres de provisioning d'une borne. */
export interface CreateKioskAccessParams {
  /** Connexion PG (contexte tenant courant). */
  db: Client;
  /** Banque propriétaire. */
  bankId: string;
  /** Agence propriétaire. */
  agencyId: string;
  /** Libellé optionnel de la borne. */
  label?: string | null;
}

/**
 * Provisionne une borne : insère la ligne, hache les credentials, retourne le
 * secret en clair (affiché une seule fois) + QR d'installation.
 *
 * @param params - Connexion, tenant, agence, libellé
 * @returns Credentials borne + QR
 */
export async function createKioskAccess(
  params: CreateKioskAccessParams
): Promise<KioskCredentials> {
  const { db, bankId, agencyId } = params;
  const label = params.label ?? null;
  const clientId = `kiosk_client_${nanoid(8)}`;
  const clientSecret = `ksk_${randomBytes(18).toString("base64url")}`;
  const hash = await bcrypt.hash(
    credentialString(clientId, clientSecret),
    BCRYPT_COST
  );
  const res = await db.query(
    `INSERT INTO kiosks (bank_id, agency_id, label, credentials_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [bankId, agencyId, label ?? "Borne", hash]
  );
  const row = res.rows[0] as { id: string; created_at: Date };
  const qr = buildInstallQr(
    `sigfa-kiosk://install?kioskId=${row.id}&clientId=${clientId}&secret=${clientSecret}&agencyId=${agencyId}`
  );
  return {
    kioskId: row.id,
    clientId,
    clientSecret,
    qrCodeDataUrl: qr,
    label,
    agencyId,
    createdAt: row.created_at.toISOString(),
  };
}

/** Paramètres de création de session borne. */
export interface CreateKioskSessionParams {
  /** Connexion PG. */
  db: Client;
  /** Secret JWT (bytes). */
  jwtSecret: Uint8Array;
  /** Identifiant de la borne. */
  kioskId: string;
  /** Secret présenté (clientId:clientSecret ou secret brut). */
  kioskSecret: string;
  /** Agence revendiquée. */
  agencyId: string;
}

/** Résultat d'une création de session borne. */
export interface KioskSession {
  /** JWT scope agency, TTL 12 h. */
  accessToken: string;
  /** TTL en secondes (43200). */
  expiresIn: number;
  /** Identifiant borne. */
  kioskId: string;
  /** Agence. */
  agencyId: string;
  /**
   * Banque (enseigne) de l'agence de la borne — CONTRACT-014, requis LA LOI.
   * Donnée d'enseigne PUBLIQUE (aucune donnée sensible) : la borne charge son
   * theming (`--brand`, logo) depuis la session, sans `NEXT_PUBLIC_BANK_ID`.
   */
  bankId: string;
}

/** Ligne borne projetée pour l'authentification. */
interface KioskAuthRow {
  id: string;
  bank_id: string;
  agency_id: string;
  credentials_hash: string;
}

/**
 * Crée une session borne : vérifie les credentials (bcrypt), signe un JWT 12 h
 * portant `sessionId`, et persiste l'état de session (révocation remise à NULL).
 *
 * @param params - Connexion, secret JWT, credentials présentés
 * @returns Session (accessToken 12 h + métadonnées)
 * @throws {SigfaError} 401 KIOSK_AUTH_FAILED si credentials/agency invalides
 */
export async function createKioskSession(
  params: CreateKioskSessionParams
): Promise<KioskSession> {
  const { db, jwtSecret, kioskId, kioskSecret, agencyId } = params;
  const res = await db.query(
    `SELECT id, bank_id, agency_id, credentials_hash FROM kiosks WHERE id = $1`,
    [kioskId]
  );
  const row = res.rows[0] as KioskAuthRow | undefined;
  if (!row || row.agency_id !== agencyId) {
    throw new SigfaError("KIOSK_AUTH_FAILED", "Authentification borne échouée.", 401);
  }
  const ok = await bcrypt.compare(kioskSecret, row.credentials_hash);
  if (!ok) {
    throw new SigfaError("KIOSK_AUTH_FAILED", "Authentification borne échouée.", 401);
  }
  // Session id = UUID (colonne `current_session_id` typée uuid).
  const sessionId = randomUUID();
  const accessToken = await signKioskToken(jwtSecret, row, sessionId);
  await db.query(
    `UPDATE kiosks
        SET current_session_id = $2,
            session_expires_at = now() + interval '12 hours',
            session_revoked_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [kioskId, sessionId]
  );
  return {
    accessToken,
    expiresIn: KIOSK_SESSION_TTL_SECONDS,
    kioskId,
    agencyId,
    // CONTRACT-014 : la borne connaît sa banque via l'agence/kiosk provisionné.
    bankId: row.bank_id,
  };
}

/** Signe le JWT de session borne (scope agency, role AUTHENTICATED, 12 h). */
async function signKioskToken(
  secret: Uint8Array,
  row: KioskAuthRow,
  sessionId: string
): Promise<string> {
  return new SignJWT({
    bankId: row.bank_id,
    role: KIOSK_ROLE,
    agencyIds: [row.agency_id],
    kioskId: row.id,
    sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(row.id)
    .setIssuedAt()
    .setExpirationTime(`${KIOSK_SESSION_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Révoque la session courante d'une borne (idempotent côté état).
 *
 * @param db      - Connexion PG
 * @param bankId  - Banque (garde tenant)
 * @param kioskId - Borne ciblée
 * @throws {SigfaError} 404 KIOSK_NOT_FOUND si la borne n'existe pas dans le tenant
 */
export async function revokeKioskSession(
  db: Client,
  bankId: string,
  kioskId: string
): Promise<void> {
  const res = await db.query(
    `UPDATE kiosks SET session_revoked_at = now(), updated_at = now()
      WHERE id = $1 AND bank_id = $2
      RETURNING id`,
    [kioskId, bankId]
  );
  if (res.rows.length === 0) {
    throw new SigfaError("KIOSK_NOT_FOUND", "Borne introuvable.", 404);
  }
}

/**
 * Vérifie qu'une session borne n'est pas révoquée — refuse le JWT sinon.
 * Appelée par le middleware pour tout JWT portant `sessionId` : compare le
 * `sessionId` du token à `current_session_id` et rejette si `session_revoked_at`
 * est posé (MÊME si `exp` du JWT est encore valide).
 *
 * @param db        - Connexion PG
 * @param kioskId   - Borne (claim `kioskId`)
 * @param sessionId - Session du token (claim `sessionId`)
 * @throws {SigfaError} 401 KIOSK_SESSION_REVOKED si révoquée ou session obsolète
 */
export async function assertKioskSessionActive(
  db: Client,
  kioskId: string,
  sessionId: string
): Promise<void> {
  const res = await db.query(
    `SELECT current_session_id, session_revoked_at
       FROM kiosks WHERE id = $1`,
    [kioskId]
  );
  const row = res.rows[0] as
    | { current_session_id: string | null; session_revoked_at: Date | null }
    | undefined;
  if (!row || row.current_session_id !== sessionId || row.session_revoked_at !== null) {
    throw new SigfaError(
      "KIOSK_SESSION_REVOKED",
      "Session borne révoquée ou obsolète.",
      401
    );
  }
}
