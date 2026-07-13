/**
 * Validation des variables d'environnement au démarrage.
 * Fail-fast : lève une erreur si JWT_SECRET est absent ou trop court.
 *
 * @module
 */

/**
 * Longueur minimale requise pour JWT_SECRET (32 caractères).
 */
const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Valide et retourne JWT_SECRET.
 * Lève une erreur explicite si absent ou inférieur à 32 caractères.
 *
 * @throws {Error} Si JWT_SECRET manquant ou trop court
 */
export function getJwtSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret || secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `[SIGFA API] JWT_SECRET manquant ou trop court (minimum ${JWT_SECRET_MIN_LENGTH} caractères). ` +
        "Configurez JWT_SECRET dans .env. Arrêt du serveur."
    );
  }
  return secret;
}

/**
 * Retourne l'URL Redis depuis REDIS_URL.
 * Défaut : redis://localhost:6379
 */
export function getRedisUrl(): string {
  return process.env["REDIS_URL"] ?? "redis://localhost:6379";
}

/**
 * Retourne l'URL de base de données depuis DATABASE_URL.
 * Défaut : postgresql://sigfa:sigfa_test@localhost:5432/sigfa_test
 */
export function getDatabaseUrl(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgresql://sigfa:sigfa_test@localhost:5432/sigfa_test"
  );
}

/**
 * URL de base publique du parcours d'enrôlement borne (QR d'installation).
 * Le QR encode `{ENROLL_BASE_URL}/enroll/{kioskId}` — jamais le token en clair.
 * Défaut : https://app.sigfa.ci
 */
export function getEnrollBaseUrl(): string {
  return process.env["ENROLL_BASE_URL"] ?? "https://app.sigfa.ci";
}
