/**
 * admin-validation.ts — inline client-side validation for the admin console.
 *
 * WEB-006 requires Zod-style client validation before any mutation, with errors
 * shown INLINE (never a modal). The `@sigfa/schemas` package (referenced by the
 * story) is a workspace package outside apps/web's dependency graph and outside
 * this story's write scope, so the constraints below are re-derived faithfully
 * from the LAW (core.yaml / admin.yaml request schemas):
 * - Service.code : `^[A-Z]{2,4}$`, unique per agency (uniqueness → server 409).
 * - Service.slaMinutes : integer ≥ 1 ; order : integer ≥ 1.
 * - BankThresholds : queueCriticalThreshold 1–500, agentInactivityMinutes 1–60,
 *   noShowTimeoutMinutes 1–30.
 * - Agency.name : non-empty ; ExceptionalClosure.reason ≤ 200.
 *
 * Each validator returns a field→message map ({} when valid), so a form can
 * render errors next to each field with zero modal.
 * @module lib/admin-validation
 */

/** A map of field name → human error message (empty when the value is valid). */
export type FieldErrors = Record<string, string>;

/** Draft shape for a service create/update form. */
export interface ServiceDraft {
  name: string;
  code: string;
  slaMinutes: number;
  order: number;
}

/** Draft shape for the bank thresholds form. */
export interface ThresholdsDraft {
  queueCriticalThreshold: number;
  agentInactivityMinutes: number;
  noShowTimeoutMinutes: number;
}

const SERVICE_CODE_RE = /^[A-Z]{2,4}$/;

/** Whether a value is an integer within [min, max] (inclusive). */
function isIntInRange(v: number, min: number, max: number): boolean {
  return Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Validates a service draft against the contract constraints.
 * @param draft - The service form values.
 * @returns Inline field errors ({} when valid).
 */
export function validateService(draft: ServiceDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.name.trim().length === 0) {
    errors.name = "Le nom du service est obligatoire.";
  }
  if (!SERVICE_CODE_RE.test(draft.code)) {
    errors.code = "Le code doit comporter 2 à 4 lettres majuscules (ex. OC, CR).";
  }
  if (!Number.isInteger(draft.slaMinutes) || draft.slaMinutes < 1) {
    errors.slaMinutes = "Le SLA doit être un entier ≥ 1 minute.";
  }
  if (!Number.isInteger(draft.order) || draft.order < 1) {
    errors.order = "La priorité doit être un entier ≥ 1.";
  }
  return errors;
}

/**
 * Validates the bank thresholds draft against the contract bounds.
 * @param draft - The thresholds form values.
 * @returns Inline field errors ({} when valid).
 */
export function validateThresholds(draft: ThresholdsDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!isIntInRange(draft.queueCriticalThreshold, 1, 500)) {
    errors.queueCriticalThreshold = "Le seuil de file critique doit être un entier entre 1 et 500.";
  }
  if (!isIntInRange(draft.agentInactivityMinutes, 1, 60)) {
    errors.agentInactivityMinutes = "L'inactivité agent doit être un entier entre 1 et 60 minutes.";
  }
  if (!isIntInRange(draft.noShowTimeoutMinutes, 1, 30)) {
    errors.noShowTimeoutMinutes = "Le délai no-show doit être un entier entre 1 et 30 minutes.";
  }
  return errors;
}

/**
 * Validates an agency name (create/update).
 * @param name - The agency name.
 * @returns Inline field errors ({} when valid).
 */
export function validateAgencyName(name: string): FieldErrors {
  const errors: FieldErrors = {};
  if (name.trim().length === 0) {
    errors.name = "Le nom de l'agence est obligatoire.";
  }
  return errors;
}

/** Whether a field-error map is empty (i.e. the draft is valid). */
export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
