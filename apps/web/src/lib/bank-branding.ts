/**
 * bank-branding — identité d'affichage de la banque / agence côté web
 * (WEB-002-HDR + TV v3 bandeau).
 *
 * Même convention de provisionnement que apps/kiosk `src/lib/kiosk-branding.ts`
 * (theming sans effort) : `NEXT_PUBLIC_BANK_NAME` +
 * `NEXT_PUBLIC_AGENCY_NAME` + `NEXT_PUBLIC_BANK_LOGO_URL`, avec replis sûrs —
 * sans logo, l'UI retombe sur la pastille `--brand` + initiale ; aucun asset
 * n'est jamais requis. Aucun libellé d'enseigne n'est figé dans les pages :
 * elles appellent {@link bankName} / {@link agencyName}.
 *
 * NOTE theming : le branchement sur l'endpoint theme tenant
 * (`GET /public/banks/{id}/theme`) remplacera ces envs — chantier theming
 * parallèle en cours ; l'API de ce module est la couture prévue pour cette
 * bascule.
 * @module lib/bank-branding
 */

/** Repli du nom de banque (démo locale, environnement non provisionné). */
export const DEFAULT_BANK_NAME = "SIGFA";

/** Repli du nom d'agence (démo locale, environnement non provisionné). */
export const DEFAULT_AGENCY_NAME = "Agence Centrale";

/** Nom public de la banque (theming libellé). */
export function bankName(
  env: Record<string, string | undefined> = process.env
): string {
  return env["NEXT_PUBLIC_BANK_NAME"] || DEFAULT_BANK_NAME;
}

/**
 * Nom public de l'agence (`NEXT_PUBLIC_AGENCY_NAME`).
 * Même repli que la borne kiosque — jamais un littéral dans les pages TV.
 */
export function agencyName(
  env: Record<string, string | undefined> = process.env
): string {
  return env["NEXT_PUBLIC_AGENCY_NAME"] || DEFAULT_AGENCY_NAME;
}

/**
 * URL optionnelle du logo de la banque (`NEXT_PUBLIC_BANK_LOGO_URL`).
 * PNG/SVG à fond transparent recommandé. `null` si non provisionnée (vide ou
 * espaces compris) : l'UI affiche alors la pastille `--brand` + initiale.
 */
export function bankLogoUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  const url = env["NEXT_PUBLIC_BANK_LOGO_URL"]?.trim();
  return url ? url : null;
}

/**
 * Initiale de la banque pour la pastille de marque (texte, jamais d'image
 * réseau). Toujours une seule lettre capitale, repli « S » (SIGFA).
 */
export function bankInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : "S";
}
