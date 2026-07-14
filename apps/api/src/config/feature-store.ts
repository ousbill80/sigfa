/**
 * config/feature-store — sélection de la matérialisation du feature-set IA
 * (F10-FEATURE-STORE), sur le patron `SMS_PROVIDER`/`EMAIL_PROVIDER`.
 *
 * LA LOI : la SOURCE des features du forecast (`ai_features`) est branchée derrière
 * un DRAPEAU. Le comportement par défaut reste SÛR et INCHANGÉ (aucune
 * matérialisation → 422 INSUFFICIENT_HISTORY gated). Le feature-store DB-backed
 * (`DbFeatureStore` sur `ai_features`, armé via `withArmedTenant`) s'active
 * UNIQUEMENT si `FEATURE_STORE_PROVIDER=db`.
 *
 * Aucun secret, aucune valeur en dur : tout vient EXCLUSIVEMENT de `process.env`.
 * Toute valeur inconnue retombe sur le défaut sûr (jamais d'activation par erreur
 * de frappe).
 *
 * @module
 */

/** Fournisseur de feature-store sélectionné. */
export type FeatureStoreProvider = "db" | "none";

/**
 * Fournisseur par défaut : `none` (aucune matérialisation lue → forecast gaté à
 * 422). C'est le comportement historique SÛR : rien ne change tant que le drapeau
 * n'est pas explicitement positionné à `db`.
 */
export const DEFAULT_FEATURE_STORE_PROVIDER: FeatureStoreProvider = "none";

/**
 * Résout le fournisseur de feature-store demandé (défaut `none`). Toute valeur
 * autre que `db` retombe sur `none` — jamais d'activation DB par mégarde.
 *
 * @returns Fournisseur sélectionné
 */
export function resolveFeatureStoreProvider(): FeatureStoreProvider {
  const raw = process.env["FEATURE_STORE_PROVIDER"];
  return typeof raw === "string" && raw.trim().toLowerCase() === "db"
    ? "db"
    : DEFAULT_FEATURE_STORE_PROVIDER;
}

/**
 * `true` si le feature-store DB-backed réel est activé (`FEATURE_STORE_PROVIDER=db`).
 * Sinon `false` (défaut sûr → provider vide → 422 gated).
 *
 * @returns Drapeau d'activation du feature-store DB
 */
export function isDbFeatureStoreEnabled(): boolean {
  return resolveFeatureStoreProvider() === "db";
}
