/**
 * KIOSK-HOME (retour visuel PO) — lib/bank-brand.ts
 * Identité tenant de l'écran d'accueil de la borne.
 *
 * Le theming couleur vit dans `--brand` (@sigfa/ui, BankThemeProvider) ; ici on
 * gère l'IDENTITÉ affichée par l'écran de marque : nom public de la banque,
 * identifiant public (provisionnement) pour charger la projection de thème
 * (GET /public/banks/{id}/theme — CONTRACT-013, route publique, zéro PII) et
 * monogramme de repli (pastille typographique, jamais d'image cassée).
 *
 * Source : variables d'environnement de provisionnement de la borne
 * (`NEXT_PUBLIC_BANK_NAME`, `NEXT_PUBLIC_BANK_ID`), avec des replis sûrs pour
 * la démo locale — la borne ne crashe jamais faute de configuration.
 */

/** Repli du nom de banque (démo locale, borne non provisionnée). */
export const DEFAULT_BANK_NAME = "SIGFA";

/**
 * Nom public de la banque (donnée d'enseigne, non-PII).
 *
 * NOTE Next.js : sans `env` explicite, on lit `process.env.NEXT_PUBLIC_*` en
 * ACCÈS DIRECT (member expression) — seule forme inlinée dans le bundle
 * client ; un accès dynamique (`env["..."]`) serait vide dans le navigateur.
 */
export function kioskBankName(env?: NodeJS.ProcessEnv): string {
  const name = env ? env["NEXT_PUBLIC_BANK_NAME"] : process.env.NEXT_PUBLIC_BANK_NAME;
  return name || DEFAULT_BANK_NAME;
}

/**
 * Identifiant public de la banque (UUID de provisionnement). `null` quand la
 * borne n'est pas provisionnée : aucune requête de thème n'est alors émise et
 * l'écran retombe sur le monogramme. Même contrainte d'inlining Next.js que
 * `kioskBankName` (accès direct à `process.env.NEXT_PUBLIC_BANK_ID`).
 */
export function kioskBankId(env?: NodeJS.ProcessEnv): string | null {
  const raw = env ? env["NEXT_PUBLIC_BANK_ID"] : process.env.NEXT_PUBLIC_BANK_ID;
  const id = (raw ?? "").trim();
  return id !== "" ? id : null;
}

/**
 * Monogramme de la banque pour la pastille de marque (texte, jamais d'image
 * réseau) : initiales des deux premiers mots du nom, en capitales. Repli « S »
 * (SIGFA) pour un nom vide.
 */
export function bankMonogram(bankName: string): string {
  const words = bankName.trim().split(/\s+/).filter((w) => w.length > 0);
  const initials = words
    .slice(0, 2)
    .map((w) => (w.charAt(0) as string).toUpperCase())
    .join("");
  return initials !== "" ? initials : "S";
}
