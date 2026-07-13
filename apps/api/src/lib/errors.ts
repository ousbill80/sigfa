/**
 * Erreurs SIGFA — LA LOI
 *
 * Toute réponse d'erreur doit respecter le format :
 * `{ error: { code: string, message: string, details?: Record<string, unknown> } }`
 *
 * @module
 */

/** Codes d'erreur SIGFA (UPPER_SNAKE_CASE, commençant par une lettre) */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "UNPROCESSABLE_ENTITY"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_SERVER_ERROR"
  | "BAD_REQUEST"
  // NET-001 — périmètre plateforme en LECTURE SEULE : toute mutation cross-tenant
  // (POST/PATCH/PUT/DELETE sur une ressource platform) est refusée avec ce code (403).
  | "PLATFORM_READ_ONLY";

/** Corps d'une réponse d'erreur conforme LA LOI */
export interface ErrorBody {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Construit un corps d'erreur conforme LA LOI.
 *
 * @param code    - Code d'erreur UPPER_SNAKE_CASE
 * @param message - Message lisible par l'humain
 * @param details - Détails optionnels
 */
export function buildError(
  code: ErrorCode | string,
  message: string,
  details?: Record<string, unknown>
): ErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/**
 * Erreur applicative SIGFA avec code LA LOI et statut HTTP.
 * Utilisée dans les services pour remonter des erreurs structurées.
 */
export class SigfaError extends Error {
  /** Code d'erreur LA LOI */
  readonly code: ErrorCode | string;
  /** Statut HTTP associé */
  readonly httpStatus: number;
  /** Détails optionnels */
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode | string,
    message: string,
    httpStatus: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "SigfaError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
