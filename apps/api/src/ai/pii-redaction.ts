/**
 * IA-004 — Rédaction / anonymisation PII des verbatims de feedback (CRITIQUE).
 *
 * Ce module masque toute donnée personnelle AVANT que le moindre insight ne soit
 * calculé ou stocké. Il ne produit JAMAIS d'appel réseau : c'est une transformation
 * de chaîne PURE et déterministe (aucune dépendance runtime, aucun I/O).
 *
 * ## Périmètre du masquage (conforme CONTRACT-008 « insights sans PII »)
 * - **Téléphones** : formats UEMOA / internationaux (`+225 07 07 07 07 07`,
 *   `0707070707`, séquences ≥ 8 chiffres avec séparateurs) → `[TÉL]`.
 * - **E-mails** : `local@domaine.tld` → `[EMAIL]`.
 * - **UUID / identifiants techniques** (ex. numéro de ticket, id client) → `[ID]`.
 * - **Noms propres** : jeton capitalisé précédé d'un marqueur d'appellation
 *   (« M. », « Mme », « Monsieur », « appelé », « nommé », « Mr », « Ms »,
 *   « named », « called ») → `[NOM]`. Le masquage se limite aux cas explicitement
 *   introduits par un marqueur pour éviter de mutiler les mots courants (approche
 *   conservatrice : mieux vaut sur-masquer un nom introduit que fuiter une PII).
 *
 * ## Garantie
 * Après {@link redactPii}, la chaîne ne contient plus aucun des motifs ci-dessus.
 * {@link containsPii} permet de tester (assertion « zéro PII ») une chaîne déjà
 * rédigée ou candidate au stockage.
 *
 * @module
 */

/** Jeton de remplacement d'un numéro de téléphone masqué. */
export const PHONE_TOKEN = "[TÉL]";
/** Jeton de remplacement d'une adresse e-mail masquée. */
export const EMAIL_TOKEN = "[EMAIL]";
/** Jeton de remplacement d'un identifiant technique masqué. */
export const ID_TOKEN = "[ID]";
/** Jeton de remplacement d'un nom propre masqué. */
export const NAME_TOKEN = "[NOM]";

/** E-mail : local@domaine.tld (tld ≥ 2 lettres). */
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** UUID v1–v5 canonique (8-4-4-4-12). */
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Téléphone. Deux formes disjointes pour éviter les faux positifs sur les dates
 * ISO (`2026-07-31` = 8 chiffres séparés par `-`) :
 *  - forme internationale `+` suivie d'au moins 8 chiffres (séparateurs tolérés) ;
 *  - forme locale sans `+` mais avec au moins 9 chiffres (numéro UEMOA à 10
 *    chiffres type `0707070707`) — au-delà de la longueur d'une date ISO.
 */
const PHONE_RE = /\+\d(?:[\s.-]?\d){7,}|\b\d(?:[\s.-]?\d){8,}\b/g;

/**
 * Marqueur d'appellation (FR/EN) suivi d'un jeton capitalisé = nom propre.
 * Ex. « M. Traoré », « Monsieur Kouassi », « named John », « appelé Awa ».
 * Le jeton nom accepte lettres accentuées, apostrophe et trait d'union.
 */
const NAME_RE =
  /\b(M\.|Mme\.?|Mlle\.?|Monsieur|Madame|Mademoiselle|Mr\.?|Mrs\.?|Ms\.?|named|called|appelé[e]?|nommé[e]?|s'appelle)\s+([A-ZÀ-Ý][\p{L}'-]+)/gu;

/**
 * Masque toute PII d'un texte libre. Ordre d'application maîtrisé :
 * e-mails et UUID d'abord (motifs les plus spécifiques), puis noms introduits,
 * puis téléphones (motif le plus large sur les chiffres) — évite qu'un motif
 * générique n'avale un motif spécifique.
 *
 * @param raw - Texte brut (verbatim client). `null`/`undefined` → chaîne vide.
 * @returns Texte avec toute PII remplacée par un jeton stable.
 */
export function redactPii(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let out = raw;
  out = out.replace(EMAIL_RE, EMAIL_TOKEN);
  out = out.replace(UUID_RE, ID_TOKEN);
  out = out.replace(NAME_RE, NAME_TOKEN);
  out = out.replace(PHONE_RE, PHONE_TOKEN);
  return out;
}

/**
 * Indique si un texte contient encore de la PII détectable (téléphone, e-mail,
 * UUID). Sert d'assertion de non-fuite sur toute chaîne candidate au stockage.
 *
 * Note : le masquage de nom est introduit par marqueur (contextuel) ; on ne le
 * teste pas ici comme « fuite » car un nom sans marqueur n'est pas distinguable
 * d'un mot courant. Les motifs structurels (tél/email/uuid) sont, eux, sûrs.
 *
 * @param text - Texte à inspecter.
 * @returns `true` si un motif PII structurel subsiste.
 */
export function containsPii(text: string): boolean {
  // Réinitialise l'état lastIndex des regex globales avant test.
  EMAIL_RE.lastIndex = 0;
  UUID_RE.lastIndex = 0;
  // Teste UUID/e-mail directement ; pour le téléphone, on neutralise d'abord les
  // UUID afin que la queue de chiffres d'un UUID (ex. `…-111111111111`) ne soit
  // jamais confondue avec un numéro. Un vrai UUID reste, lui, détecté par UUID_RE.
  if (EMAIL_RE.test(text) || UUID_RE.test(text)) return true;
  PHONE_RE.lastIndex = 0;
  return PHONE_RE.test(text.replace(UUID_RE, ID_TOKEN));
}
