/**
 * KIOSK-BORNE — kiosk-branding.ts
 * Identité d'affichage de la borne : nom de banque + nom d'agence + logo.
 *
 * Le theming banque (couleur) vit dans le token `--brand` (@sigfa/ui) ; ici on
 * gère les libellés publics affichés par le bandeau d'en-tête, l'accueil et le
 * ticket imprimé, plus l'URL de logo optionnelle. Aucune PII : ce sont des
 * données publiques d'enseigne.
 *
 * Source : variables d'environnement de provisionnement de la borne
 * (`NEXT_PUBLIC_BANK_NAME`, `NEXT_PUBLIC_AGENCY_NAME`,
 * `NEXT_PUBLIC_BANK_LOGO_URL`), avec des replis sûrs pour la démo locale — la
 * borne ne crashe jamais faute de configuration : sans logo, l'UI retombe sur
 * la pastille `--brand` + initiale (theming banque sans asset).
 */

/** Repli du nom de banque (démo locale, borne non provisionnée). */
export const DEFAULT_BANK_NAME = "SIGFA";

/** Repli du nom d'agence (démo locale, borne non provisionnée). */
export const DEFAULT_AGENCY_NAME = "Agence Centrale";

/** Nom public de la banque (theming libellé). */
export function kioskBankName(env: NodeJS.ProcessEnv = process.env): string {
  return env["NEXT_PUBLIC_BANK_NAME"] || DEFAULT_BANK_NAME;
}

/**
 * URL optionnelle du logo de la banque (`NEXT_PUBLIC_BANK_LOGO_URL`).
 * PNG/SVG à fond transparent recommandé. `null` si non provisionnée (vide ou
 * espaces compris) : l'UI affiche alors la pastille `--brand` + initiale —
 * aucun logo n'est jamais requis pour brander une borne.
 */
export function kioskBankLogoUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env["NEXT_PUBLIC_BANK_LOGO_URL"]?.trim();
  return url ? url : null;
}

/** Nom public de l'agence où la borne est installée. */
export function kioskAgencyName(env: NodeJS.ProcessEnv = process.env): string {
  return env["NEXT_PUBLIC_AGENCY_NAME"] || DEFAULT_AGENCY_NAME;
}

/**
 * Initiale de la banque pour la pastille de marque (SVG/texte, jamais d'image
 * réseau). Toujours une seule lettre capitale, repli « S » (SIGFA).
 */
export function bankInitial(bankName: string): string {
  const first = bankName.trim().charAt(0);
  return first ? first.toUpperCase() : "S";
}
