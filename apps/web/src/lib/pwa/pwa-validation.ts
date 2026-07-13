/**
 * NOTIF-005-B — lightweight input validation for the PWA confirm step.
 * @module lib/pwa/pwa-validation
 */

/** Loose E.164-ish check: optional `+`, 8–15 digits. Phone stays OPTIONAL. */
const E164_LIKE = /^\+?[0-9]{8,15}$/;

/**
 * Validates an optional phone number. Empty is valid (phone is optional).
 * Spaces are tolerated in input and stripped before checking.
 *
 * @param raw - Raw phone input.
 * @returns `true` when empty or plausibly E.164.
 */
export function isValidPhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  return E164_LIKE.test(trimmed.replace(/\s/g, ""));
}

/** Normalizes a phone number by stripping whitespace. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\s/g, "").trim();
}

/** True when a non-empty phone is present (i.e. consent becomes required). */
export function hasPhone(raw: string): boolean {
  return normalizePhone(raw).length > 0;
}
