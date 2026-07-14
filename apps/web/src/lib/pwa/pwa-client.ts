/**
 * NOTIF-005-B — typed public API client for the ticket PWA.
 *
 * API-First: every call goes through the generated `@sigfa/contracts` public
 * client — no invented routes. The PWA only needs three public, unauthenticated
 * surfaces (all already at the contract, CONTRACT-003):
 *   - `POST /public/tickets`               (channel `QR`, idempotent emission)
 *   - `GET  /public/tickets/{trackingId}`  (live tracking)
 *   - `GET  /public/agencies/{id}/operations?serviceId=` (optional operations)
 *
 * The uuid interne du ticket is never exposed — only `trackingId` (nanoid 21).
 *
 * @module lib/pwa/pwa-client
 */
import { createSigfaClient, type PublicPaths } from "@sigfa/contracts";

/** Public ticket status (live tracking payload). */
export type PublicTicketStatus =
  PublicPaths["/public/tickets/{trackingId}"]["get"]["responses"]["200"]["content"]["application/json"];

/** Ticket-created response after a QR emission. */
export type PublicTicketCreated =
  PublicPaths["/public/tickets"]["post"]["responses"]["201"]["content"]["application/json"];

/** One active operation for a service (SLA résolu). */
export type PublicOperation =
  PublicPaths["/public/agencies/{agencyId}/operations"]["get"]["responses"]["200"]["content"]["application/json"]["data"][number];

/** Input for a QR-channel ticket emission (phone optional, consent gated). */
export interface EmitQrTicketInput {
  readonly agencyId: string;
  readonly serviceId: string;
  readonly operationId?: string;
  /** E.164 phone — OPTIONAL (tracking works via trackingId without it). */
  readonly phoneNumber?: string;
  /** Required by the API when a phone number is provided (UEMOA opt-in). */
  readonly smsConsent?: boolean;
  /** Idempotency key — same key + payload = same ticket (24 h window). */
  readonly idempotencyKey: string;
}

/** Discriminated outcome of a network call — never throws to the UI. */
export type PwaResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly status: number; readonly code?: string };

/** Minimal shape of a contract error body (opaque code + message). */
interface ContractErrorBody {
  error?: { code?: string };
}

/** Extracts a stable error code from an opaque contract error body. */
function errorCodeOf(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as ContractErrorBody).error;
    if (err && typeof err.code === "string") return err.code;
  }
  return undefined;
}

/** Creates the typed public client bound to the given base URL. */
function publicClient(baseUrl: string): ReturnType<typeof createSigfaClient<"public">> {
  return createSigfaClient("public", baseUrl);
}

// PublicPaths is re-exported for consumers who type their own handlers.
export type { PublicPaths };

/**
 * Emits a ticket through the QR channel (idempotent).
 *
 * @param baseUrl - Public API base URL.
 * @param input - Emission parameters (phone optional).
 * @returns The created ticket, or a typed failure.
 */
export async function emitQrTicket(
  baseUrl: string,
  input: EmitQrTicketInput,
): Promise<PwaResult<PublicTicketCreated>> {
  const client = publicClient(baseUrl);
  const body = {
    channel: "QR" as const,
    serviceId: input.serviceId,
    agencyId: input.agencyId,
    ...(input.operationId ? { operationId: input.operationId } : {}),
    ...(input.phoneNumber
      ? { phoneNumber: input.phoneNumber, smsConsent: input.smsConsent ?? false }
      : {}),
  };
  const { data, error, response } = await client.POST("/public/tickets", {
    params: { header: { "X-Idempotency-Key": input.idempotencyKey } },
    body,
  });
  if (data) return { ok: true, data: data as PublicTicketCreated };
  return { ok: false, status: response?.status ?? 0, code: errorCodeOf(error) };
}

/**
 * Fetches the current public status of a ticket by its trackingId.
 *
 * @param baseUrl - Public API base URL.
 * @param trackingId - nanoid(21) tracking identifier.
 * @returns The ticket status, or a typed failure.
 */
export async function trackTicket(
  baseUrl: string,
  trackingId: string,
): Promise<PwaResult<PublicTicketStatus>> {
  const client = publicClient(baseUrl);
  const { data, error, response } = await client.GET("/public/tickets/{trackingId}", {
    params: { path: { trackingId } },
  });
  if (data) return { ok: true, data: data as PublicTicketStatus };
  return { ok: false, status: response?.status ?? 0, code: errorCodeOf(error) };
}

/**
 * Lists active operations of a service for an agency (optional refinement).
 *
 * @param baseUrl - Public API base URL.
 * @param agencyId - Agency UUID resolved from the QR token.
 * @param serviceId - Service UUID to expand into operations.
 * @returns The operation list, or a typed failure.
 */
export async function listOperations(
  baseUrl: string,
  agencyId: string,
  serviceId: string,
): Promise<PwaResult<readonly PublicOperation[]>> {
  const client = publicClient(baseUrl);
  const { data, error, response } = await client.GET(
    "/public/agencies/{agencyId}/operations",
    { params: { path: { agencyId }, query: { serviceId } } },
  );
  if (data) return { ok: true, data: (data.data ?? []) as PublicOperation[] };
  return { ok: false, status: response?.status ?? 0, code: errorCodeOf(error) };
}
