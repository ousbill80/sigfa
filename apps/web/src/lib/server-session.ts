/**
 * server-session — lecture VÉRIFIÉE du cookie httpOnly côté serveur (S2/S3).
 *
 * Server components uniquement (next/headers). Le cookie `access_token` n'est
 * jamais exposé au JS client : il est lu ici, sa signature est vérifiée (S1,
 * lib/session), et seules les données nécessaires descendent dans l'arbre.
 *
 * S3 : les pages authentifiées dérivent leur contexte tenant
 * (bankId / agencyId / role) des claims du JWT VÉRIFIÉ — jamais de constantes
 * tenant côté client — et parlent à l'API via le proxy same-origin `/api/rt`
 * (Bearer injecté côté serveur, cf. app/api/rt/[...path]/route).
 * @module lib/server-session
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getJwtSecret, verifySessionToken, type SessionClaims } from "./session";
import { resolveRealtimeMode, restApiBase } from "./realtime-env";
import type { Role } from "./roles";

/** Nom du cookie httpOnly posé par /api/auth/login. */
export const ACCESS_TOKEN_COOKIE = "access_token";

/** Session vérifiée : le token brut (pour le handshake socket) + ses claims. */
export interface VerifiedSession {
  /** JWT compact dont la signature a vérifié. */
  token: string;
  /** Claims de session extraits APRÈS vérification. */
  claims: SessionClaims;
}

/**
 * Fixtures tenant du mode MOCK (bascule d'env RT-001b) — alignées sur les
 * seeds du mock Prism. JAMAIS utilisées en mode real (S3).
 */
export const MOCK_TENANT: { bankId: string; agencyId: string; role: Role } = {
  bankId: "11111111-1111-4111-a111-111111111111",
  agencyId: "33333333-3333-4333-a333-333333333333",
  role: "BANK_ADMIN",
};

/** Contexte de page authentifiée (S3). */
export interface TenantPageContext {
  /** Base API : proxy same-origin `/api/rt` en real, mock Prism sinon. */
  apiBase: string;
  /** Banque du JWT vérifié (vide pour SUPER_ADMIN — scope platform). */
  bankId: string;
  /** Première agence du scope JWT vérifié (vide si scope banque pur). */
  agencyId: string;
  /** Rôle RBAC du JWT vérifié. */
  role: Role;
  /** Vrai en mode temps réel. */
  realtime: boolean;
}

/**
 * Lit le cookie httpOnly et le vérifie (S1). Ne retourne le token que si la
 * signature a vérifié.
 * @returns La session vérifiée, ou null.
 */
export async function readVerifiedSession(): Promise<VerifiedSession | null> {
  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;
  const claims = await verifySessionToken(token, getJwtSecret());
  if (!token || !claims) return null;
  return { token, claims };
}

/**
 * Résout le contexte tenant d'une page authentifiée (S3).
 * - mode mock : base d'env + fixtures MOCK_TENANT (bascule inchangée) ;
 * - mode real : proxy `/api/rt` + claims du JWT vérifié ; session absente ou
 *   invalide → redirection /login (défense en profondeur, en plus du
 *   middleware).
 * @returns Le contexte tenant de la page.
 */
export async function resolveTenantContext(): Promise<TenantPageContext> {
  if (resolveRealtimeMode() !== "real") {
    return { apiBase: restApiBase(), ...MOCK_TENANT, realtime: false };
  }

  const verified = await readVerifiedSession();
  if (!verified) redirect("/login");

  const { claims } = verified;
  return {
    apiBase: "/api/rt",
    bankId: claims.bankId ?? "",
    agencyId: claims.agencyIds[0] ?? "",
    role: claims.role,
    realtime: true,
  };
}
