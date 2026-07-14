/**
 * agency-label — résolution SERVEUR du nom de l'agence de rattachement
 * (WEB-002-HDR).
 *
 * Les claims JWT portent `agencyIds` (UUIDs) ; le NOM est résolu côté server
 * component via `GET /agencies/{id}` (contrat core 1.1.0 — AGENT minimum,
 * scope agence strict). S2 : le Bearer est injecté ICI, côté serveur — le
 * token brut ne descend jamais dans l'arbre client.
 *
 * Règles d'affichage :
 * - 0 agence (ex. BANK_ADMIN)      → `null` (le bandeau montre la banque seule) ;
 * - 1 agence                       → « Agence Plateau » ;
 * - N agences                      → « Agence Plateau +N-1 » (la première + compteur).
 *
 * Fail-soft : toute erreur réseau/HTTP → `null` (le bandeau ne casse jamais
 * une console pour un libellé).
 * @module lib/agency-label
 */

/** Session minimale requise (sous-ensemble de VerifiedSession). */
export interface AgencySession {
  /** JWT compact vérifié (Bearer serveur uniquement — S2). */
  token: string;
  /** Claims nécessaires à la résolution. */
  claims: { agencyIds: string[] };
}

/**
 * Base REST `/api/v1` de l'API réelle — même dérivation que le proxy
 * same-origin `/api/rt` (origine de `NEXT_PUBLIC_API_URL` + préfixe /api/v1).
 * @param env - Environnement (défaut : process.env).
 * @returns La base REST absolue.
 */
export function apiV1Base(
  env: Record<string, string | undefined> = process.env
): string {
  const raw = env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4010";
  let origin: string;
  try {
    origin = new URL(raw).origin;
  } catch {
    origin = raw;
  }
  return `${origin}/api/v1`;
}

/**
 * Résout le libellé d'agence de rattachement de l'utilisateur connecté.
 * @param session   - Session vérifiée (token + claims.agencyIds).
 * @param fetchImpl - Fetch injectable (tests).
 * @returns Le libellé (« Nom » ou « Nom +N »), ou null (0 agence / erreur).
 */
export async function resolveAgencyLabel(
  session: AgencySession,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  const ids = session.claims.agencyIds;
  const first = ids[0];
  if (!first) return null;

  try {
    const res = await fetchImpl(`${apiV1Base()}/agencies/${first}`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: unknown };
    const name =
      typeof body.name === "string" && body.name.length > 0 ? body.name : null;
    if (!name) return null;
    return ids.length > 1 ? `${name} +${ids.length - 1}` : name;
  } catch {
    return null;
  }
}
