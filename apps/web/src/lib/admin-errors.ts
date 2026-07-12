/**
 * admin-errors.ts — translate contract error codes to human French messages.
 *
 * WEB-006 (Anormal branch): a 409 conflict from admin.yaml / core.yaml must be
 * shown as natural language, never a raw code. The mapping covers the codes the
 * console can trigger (service code conflict, agency with open tickets,
 * idempotency conflict, template variable, import bounds). Any unknown code
 * falls back to a generic human sentence — the raw code is NEVER surfaced.
 * @module lib/admin-errors
 */

/** Shape of the contract error envelope (errorSchema). */
export interface ApiError {
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

/** Known contract error codes → human French messages. */
const CODE_MESSAGES: Record<string, string> = {
  // core.yaml — service code unique per agency (POST /services 409).
  SERVICE_CODE_EXISTS: "Ce code de service existe déjà dans cette agence.",
  DUPLICATE_SERVICE_CODE: "Ce code de service existe déjà dans cette agence.",
  // core.yaml — DELETE /agencies/{id} with open tickets.
  AGENCY_HAS_OPEN_TICKETS: "Cette agence a des tickets ouverts et ne peut pas être fermée.",
  // Generic uniqueness conflict.
  CONFLICT: "Cette valeur existe déjà.",
  DUPLICATE_EMAIL: "Cette adresse email est déjà enregistrée.",
  // admin.yaml — sms-templates unknown variable (422).
  UNKNOWN_TEMPLATE_VARIABLE: "Ce modèle contient une variable non autorisée.",
  UNPROCESSABLE_ENTITY: "Certaines valeurs saisies ne sont pas valides.",
  // agents.yaml — import bounds.
  IMPORT_TOO_LARGE: "Le fichier dépasse la limite de 500 lignes.",
  INVALID_CSV_FORMAT: "Le fichier CSV est invalide (encodage ou séparateur incorrect).",
  // idempotency (critical mutations only).
  IDEMPOTENCY_CONFLICT: "Une opération identique est déjà en cours de traitement.",
};

/** Generic fallback — used when the code is unknown (raw code never shown). */
export const GENERIC_CONFLICT_MESSAGE = "Une opération identique existe déjà. Veuillez vérifier vos données.";

/** Generic fallback for any unmapped error. */
export const GENERIC_ERROR_MESSAGE = "Une erreur est survenue. Veuillez réessayer.";

/**
 * Translates a contract error envelope into a human French message.
 * The raw error code is NEVER returned to the UI.
 * @param err - The parsed error envelope (or unknown value).
 * @param isConflict - Whether the HTTP status was 409 (drives the fallback tone).
 * @returns A human-readable French message.
 */
export function translateApiError(err: unknown, isConflict = false): string {
  const code = (err as ApiError | null | undefined)?.error?.code;
  if (typeof code === "string" && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }
  return isConflict ? GENERIC_CONFLICT_MESSAGE : GENERIC_ERROR_MESSAGE;
}
