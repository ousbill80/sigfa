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

/**
 * Draft shape for an operation create/update form (MODEL-WEB-A).
 * `slaMinutes` is nullable: `null` (or empty) means "inherit the service SLA".
 * There is intentionally NO priority field (D4).
 */
export interface OperationDraft {
  code: string;
  name: string;
  /** Own SLA in minutes; `null` → inherits the parent service SLA (D4). */
  slaMinutes: number | null;
  displayOrder: number;
  iconKey?: string;
}

/**
 * Draft shape for the conseiller (relationship manager) marking form (MODEL-WEB-B).
 * When `isRelationshipManager` is true, `displayName` (public name shown on the
 * kiosk) becomes REQUIRED. `photoUrl` is always optional (a valid http(s) URL).
 */
export interface ConseillerDraft {
  isRelationshipManager: boolean;
  displayName: string;
  photoUrl: string;
}

/** Draft shape for the bank thresholds form. */
export interface ThresholdsDraft {
  queueCriticalThreshold: number;
  agentInactivityMinutes: number;
  noShowTimeoutMinutes: number;
}

const SERVICE_CODE_RE = /^[A-Z]{2,4}$/;

/** Operation code — 2 to 6 chars A-Z/0-9, unique per service (MODEL-CONTRACT-A / D10). */
const OPERATION_CODE_RE = /^[A-Z0-9]{2,6}$/;

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
 * Validates an operation draft against the contract constraints (MODEL-CONTRACT-A).
 * `slaMinutes === null` is VALID → the operation inherits the service SLA (D4).
 * No priority field is validated (D4 — priority stays on the ticket enum).
 * @param draft - The operation form values.
 * @returns Inline field errors ({} when valid).
 */
export function validateOperation(draft: OperationDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.name.trim().length === 0) {
    errors.name = "Le nom de l'opération est obligatoire.";
  }
  if (!OPERATION_CODE_RE.test(draft.code)) {
    errors.code = "Le code doit comporter 2 à 6 caractères A-Z ou 0-9 (ex. DEP, RET1).";
  }
  // slaMinutes nullable: null → hérite du service ; sinon entier ≥ 1.
  if (draft.slaMinutes !== null && (!Number.isInteger(draft.slaMinutes) || draft.slaMinutes < 1)) {
    errors.slaMinutes = "Le SLA doit être vide (hérite du service) ou un entier ≥ 1 minute.";
  }
  if (!Number.isInteger(draft.displayOrder) || draft.displayOrder < 1) {
    errors.displayOrder = "L'ordre d'affichage doit être un entier ≥ 1.";
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

/** A photo URL must be an absolute http(s) URL (contract `format: uri`). */
const PHOTO_URL_RE = /^https?:\/\/\S+$/i;

/**
 * Validates the conseiller (relationship manager) marking draft (MODEL-WEB-B, D5).
 * `displayName` is REQUIRED as soon as `isRelationshipManager` is true — the
 * public name + photo are what appear on the kiosk relationship-managers list.
 * When the agent is NOT a conseiller, both fields are free (nothing to validate).
 * `photoUrl` stays optional but, when filled, must be a valid http(s) URL.
 * @param draft - The conseiller form values.
 * @returns Inline field errors ({} when valid).
 */
export function validateConseiller(draft: ConseillerDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (draft.isRelationshipManager && draft.displayName.trim().length === 0) {
    errors.displayName =
      "Le nom public est obligatoire pour un conseiller (il apparaît sur la borne).";
  }
  if (draft.photoUrl.trim().length > 0 && !PHOTO_URL_RE.test(draft.photoUrl.trim())) {
    errors.photoUrl = "La photo doit être une URL valide (http ou https).";
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
