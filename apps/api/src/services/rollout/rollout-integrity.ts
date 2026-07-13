/**
 * rollout-integrity — NET-002 : preuve d'intégrité d'un artefact de version borne.
 *
 * Périmètre ops/CI (hors contrat client public). La chaîne de signature réelle
 * (clé matérielle, notarisation Electron, CI de build signé) est **GATED** vers
 * l'intégration matérielle pilote (cf. `_notes` Q2 + KIOSK-005 hors scope).
 *
 * Ici : un **stub HMAC-SHA256 vérifiable en CI**. Le hash est réel et vérifiable
 * (aucun mock : `node:crypto`) ; ce qui est stubé est la *provenance* de la clé
 * (secret de test injecté vs HSM/notarisation réelle). La borne refuse tout
 * artefact non signé ou altéré AVANT application.
 *
 * @module
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** Artefact de version borne (métadonnées + payload). Aucune PII, aucun métier. */
export interface Artifact {
  /** Version cible (ex. "1.4.2"). */
  readonly version: string;
  /** Contenu binaire de l'artefact (bundle Electron/kiosk). */
  readonly payload: Uint8Array;
}

/** Artefact accompagné de sa preuve d'intégrité (signature détachée). */
export interface SignedArtifact extends Artifact {
  /** SHA-256 du payload (hex) — checksum public. */
  readonly sha256: string;
  /** Signature HMAC-SHA256 détachée (hex) couvrant `version|sha256`. */
  readonly signature: string;
}

/** Motifs d'échec de vérification d'intégrité. */
export type IntegrityFailureReason =
  | "MISSING_SIGNATURE"
  | "HASH_MISMATCH"
  | "BAD_SIGNATURE";

/** Résultat de vérification d'intégrité. */
export type IntegrityResult =
  | { readonly ok: true; readonly sha256: string }
  | { readonly ok: false; readonly reason: IntegrityFailureReason };

/** Calcule le SHA-256 (hex) d'un payload. */
export function computeSha256(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Signe un artefact (stub CI). Produit checksum + signature détachée.
 *
 * NOTE : `secret` = secret de test injecté. En intégration réelle (GATED), la
 * signature provient d'une clé matérielle/notarisation — la FORME (checksum +
 * signature détachée vérifiée avant application) est identique et déjà testée.
 */
export function signArtifact(artifact: Artifact, secret: string): SignedArtifact {
  const sha256 = computeSha256(artifact.payload);
  const signature = createHmac("sha256", secret)
    .update(`${artifact.version}|${sha256}`)
    .digest("hex");
  return { ...artifact, sha256, signature };
}

/** Comparaison hex à temps constant (évite les oracles de timing). */
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Vérifie l'intégrité d'un artefact signé AVANT application (côté borne).
 *
 * Refuse : signature absente/vide, payload altéré (hash ≠), signature invalide.
 * Aucune version non signée n'est appliquée.
 */
export function verifyArtifact(
  artifact: SignedArtifact,
  secret: string,
): IntegrityResult {
  if (!artifact.signature || artifact.signature.length === 0) {
    return { ok: false, reason: "MISSING_SIGNATURE" };
  }
  const actualSha = computeSha256(artifact.payload);
  if (!hexEqual(actualSha, artifact.sha256)) {
    return { ok: false, reason: "HASH_MISMATCH" };
  }
  const expected = createHmac("sha256", secret)
    .update(`${artifact.version}|${artifact.sha256}`)
    .digest("hex");
  if (!hexEqual(expected, artifact.signature)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  return { ok: true, sha256: actualSha };
}

/** Seuil de quarantaine (D3 : 3 échecs d'intégrité). */
export const QUARANTINE_FAILURE_THRESHOLD = 3;

/** État de quarantaine d'une borne (compteur d'échecs d'intégrité). */
export interface IntegrityAttemptState {
  /** Nombre d'échecs consécutifs d'intégrité. */
  readonly failures: number;
  /** true si la borne est en quarantaine (reste sur version stable). */
  readonly quarantined: boolean;
}

/** État initial (aucun échec). */
export const INITIAL_INTEGRITY_STATE: IntegrityAttemptState = {
  failures: 0,
  quarantined: false,
};

/**
 * Applique un résultat de vérification à l'état de tentatives d'une borne.
 *
 * - succès → réinitialise le compteur (pas de quarantaine).
 * - échec → incrémente ; à `QUARANTINE_FAILURE_THRESHOLD` échecs → quarantaine.
 *   Une borne en quarantaine y reste (pas de boucle de téléchargement).
 */
export function applyIntegrityAttempt(
  state: IntegrityAttemptState,
  result: IntegrityResult,
): IntegrityAttemptState {
  if (state.quarantined) return state;
  if (result.ok) return INITIAL_INTEGRITY_STATE;
  const failures = state.failures + 1;
  return {
    failures,
    quarantined: failures >= QUARANTINE_FAILURE_THRESHOLD,
  };
}
