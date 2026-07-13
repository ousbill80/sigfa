/**
 * demo-login — connexion démo directe par rôle (PHASE DE TEST uniquement).
 *
 * Feature gatée par `SIGFA_DEMO_LOGIN=1` (variable d'env SERVEUR). OFF par
 * défaut : fail-closed — la page de login reste strictement inchangée et la
 * route /api/auth/demo-login répond 404. C'est la garantie prod.
 *
 * Les mots de passe démo vivent UNIQUEMENT côté serveur, dans les variables
 * d'env `DEMO_LOGIN_PASSWORD_<ROLE>` — jamais dans le bundle client. Les
 * emails sont les emails déterministes du seed (packages/database/src/seed) :
 * `demo.<role en minuscules, _ → .>@sigfa-demo.ci`.
 * @module lib/demo-login
 */

/** Rôles ouverts à la connexion démo (liste FERMÉE — jamais SUPER_ADMIN). */
export const DEMO_LOGIN_ROLES = [
  "BANK_ADMIN",
  "AGENCY_DIRECTOR",
  "MANAGER",
  "AGENT",
  "AUDITOR",
] as const;

/** Rôle autorisé pour la connexion démo. */
export type DemoLoginRole = (typeof DEMO_LOGIN_ROLES)[number];

/** Identifiants démo résolus côté serveur (jamais envoyés au client). */
export interface DemoCredentials {
  /** Email déterministe du seed. */
  email: string;
  /** Mot de passe lu depuis l'env serveur. */
  password: string;
}

/**
 * Indique si la connexion démo est activée (`SIGFA_DEMO_LOGIN=1`, serveur).
 * Toute autre valeur (absente, vide, "0", "true"…) → OFF (fail-closed).
 * @returns true uniquement quand le flag vaut exactement "1"
 */
export function isDemoLoginEnabled(): boolean {
  return process.env["SIGFA_DEMO_LOGIN"] === "1";
}

/**
 * Garde de type : la valeur est-elle un rôle démo de la liste fermée ?
 * @param value - Valeur arbitraire (body de requête non fiable)
 * @returns true si la valeur est l'un des 5 rôles démo
 */
export function isDemoLoginRole(value: unknown): value is DemoLoginRole {
  return (
    typeof value === "string" && (DEMO_LOGIN_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Dérive l'email de démo déterministe du seed pour un rôle.
 * Même dérivation que packages/database/src/seed/index.ts (`demoEmail`).
 * @param role - Rôle démo
 * @returns Email de démo (ex. demo.bank.admin@sigfa-demo.ci)
 */
export function demoEmailForRole(role: DemoLoginRole): string {
  return `demo.${role.toLowerCase().replace(/_/g, ".")}@sigfa-demo.ci`;
}

/**
 * Lit le mot de passe démo d'un rôle dans l'env serveur.
 * @param role - Rôle démo
 * @returns Le mot de passe, ou undefined si absent/vide
 */
function demoPasswordForRole(role: DemoLoginRole): string | undefined {
  const password = process.env[`DEMO_LOGIN_PASSWORD_${role}`];
  return password !== undefined && password.length > 0 ? password : undefined;
}

/**
 * Résout les identifiants démo d'un rôle — null si le flag est OFF ou si le
 * mot de passe env est absent (fail-closed).
 * @param role - Rôle démo
 * @returns Identifiants serveur, ou null
 */
export function getDemoCredentials(role: DemoLoginRole): DemoCredentials | null {
  if (!isDemoLoginEnabled()) {
    return null;
  }
  const password = demoPasswordForRole(role);
  if (password === undefined) {
    return null;
  }
  return { email: demoEmailForRole(role), password };
}

/**
 * Liste les rôles démo réellement disponibles — SEULE information exposée à
 * la page de login (jamais les secrets). [] quand le flag est OFF.
 * @returns Rôles dont le mot de passe env est fourni, dans l'ordre canonique
 */
export function getAvailableDemoRoles(): DemoLoginRole[] {
  if (!isDemoLoginEnabled()) {
    return [];
  }
  return DEMO_LOGIN_ROLES.filter((role) => demoPasswordForRole(role) !== undefined);
}
