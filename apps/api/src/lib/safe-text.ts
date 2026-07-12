/**
 * Refinement Zod de texte sûr — durcissement des entrées CRUD.
 *
 * PostgreSQL rejette tout octet NUL dans une string encodée UTF-8
 * (`invalid byte sequence for encoding "UTF8": 0x00`, code 22021) → l'API
 * renverrait un 500. On rejette donc À LA VALIDATION toute string contenant un
 * octet NUL ou un autre caractère de contrôle C0 interdit par PostgreSQL,
 * afin d'émettre un 422 déterministe au lieu d'un 500.
 *
 * Autorisés : tab (`\t`), saut de ligne (`\n`), retour chariot (`\r`), et TOUT
 * l'Unicode imprimable — les lettres accentuées FR/Dioula/Baoulé (`é`, `à`, `ô`,
 * `ç`, …) NE SONT PAS filtrées (ce ne sont pas des caractères de contrôle).
 *
 * @module
 */

import { z } from "zod";

/**
 * Caractères de contrôle C0 interdits dans une string persistée :
 * `\x00`–`\x08`, `\x0B`, `\x0C`, `\x0E`–`\x1F`.
 * Exceptions autorisées : `\t` (0x09), `\n` (0x0A), `\r` (0x0D).
 */
const FORBIDDEN_CONTROL_RE =
  // eslint-disable-next-line no-control-regex -- filtre volontaire des C0 interdits par PostgreSQL
  /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

/** Message de validation émis lorsqu'un caractère de contrôle interdit est détecté. */
export const CONTROL_CHAR_MESSAGE =
  "La valeur contient un caractère de contrôle interdit (octet NUL / C0).";

/**
 * Indique si une string contient un octet NUL ou un caractère de contrôle C0
 * interdit (hors `\t`, `\n`, `\r`).
 *
 * @param value - String à inspecter
 * @returns `true` si un caractère interdit est présent
 */
export function hasForbiddenControlChar(value: string): boolean {
  return FORBIDDEN_CONTROL_RE.test(value);
}

/**
 * Construit un schéma Zod string durci qui rejette les octets NUL et les
 * caractères de contrôle C0 interdits (préserve l'Unicode accentué).
 *
 * À composer avec les contraintes usuelles (`.min`, `.max`, `.optional`, …) :
 * `safeText().min(1)`, `safeText().max(160).optional()`.
 *
 * @returns Schéma `z.ZodString` refiné anti-caractères de contrôle
 */
export function safeText(): z.ZodString {
  return z.string().refine((v) => !hasForbiddenControlChar(v), {
    message: CONTROL_CHAR_MESSAGE,
  });
}
