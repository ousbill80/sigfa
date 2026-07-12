/**
 * Sanitation du commentaire de feedback client (API-010).
 *
 * Règles (LA LOI) :
 * - Strip HTML : toutes les balises `<...>` sont retirées (défense XSS).
 * - Longueur : ≤ 500 caractères APRÈS strip (jamais de contournement par balises).
 * - Caractères de contrôle : rejetés (sauf `\n` LF et `\t` TAB, tolérés).
 *
 * Aucune PII n'est produite : cette fonction ne fait que nettoyer un texte libre.
 *
 * @module
 */

/** Longueur maximale d'un commentaire (LA LOI `FeedbackRequest.comment.maxLength`). */
export const MAX_COMMENT_LENGTH = 500;

/** Commentaire trop long après nettoyage. */
export class CommentTooLongError extends Error {
  constructor() {
    super(`Le commentaire dépasse ${MAX_COMMENT_LENGTH} caractères.`);
    this.name = "CommentTooLongError";
  }
}

/** Commentaire contenant un caractère de contrôle interdit. */
export class CommentControlCharError extends Error {
  constructor() {
    super("Le commentaire contient un caractère de contrôle interdit.");
    this.name = "CommentControlCharError";
  }
}

/**
 * Détecte un caractère de contrôle interdit (hors `\t` et `\n`).
 * Couvre C0 (0x00–0x1F sauf 0x09/0x0A), DEL (0x7F) et C1 (0x80–0x9F).
 *
 * @param text - Texte à inspecter
 */
function hasForbiddenControlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Nettoie un commentaire de feedback selon LA LOI.
 *
 * @param raw - Commentaire brut (peut être null/undefined)
 * @returns Commentaire nettoyé, ou `null` si absent/vide après nettoyage
 * @throws {CommentControlCharError} si un caractère de contrôle interdit est présent
 * @throws {CommentTooLongError}     si la longueur dépasse {@link MAX_COMMENT_LENGTH}
 */
export function sanitizeComment(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  if (hasForbiddenControlChar(raw)) throw new CommentControlCharError();
  const stripped = raw.replace(/<[^>]*>/g, "").trim();
  if (stripped.length === 0) return null;
  if (stripped.length > MAX_COMMENT_LENGTH) throw new CommentTooLongError();
  return stripped;
}
