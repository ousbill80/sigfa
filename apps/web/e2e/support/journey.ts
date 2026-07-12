/**
 * Helpers de parcours E2E (RT-003) — appels de CONTRAT contre l'API réelle.
 *
 * La création de ticket « à la borne » passe par `POST /api/v1/tickets`
 * (rôle AGENT, scope agence) : le backend réel n'implémente PAS
 * `POST /public/tickets` (route déclarée au contrat + RBAC mais sans handler —
 * couture consignée). Ce chemin produit un vrai ticket WAITING + trackingId
 * réel, qui alimente ensuite tout le pipeline socket réel.
 *
 * @module e2e/support/journey
 */
import type { E2eState } from "./state";

/** Ticket émis (sous-ensemble de la réponse POST /tickets). */
export interface EmittedTicket {
  id: string;
  number: string;
  displayNumber: string;
  trackingId: string;
  status: string;
}

/** Émet un ticket « borne » (WAITING) via l'API réelle authentifiée. */
export async function takeTicketAtKiosk(state: E2eState): Promise<EmittedTicket> {
  const res = await fetch(`${state.apiBase}/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.agentToken}`,
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ serviceId: state.serviceId, channel: "KIOSK" }),
  });
  if (res.status !== 201) {
    throw new Error(`POST /tickets a échoué (${res.status}) : ${await res.text()}`);
  }
  return (await res.json()) as EmittedTicket;
}

/** Suivi public d'un ticket par trackingId (route publique réelle). */
export async function trackTicket(
  state: E2eState,
  trackingId: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${state.apiBase}/public/tickets/${trackingId}`);
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

/** Soumet un feedback public par trackingId (route publique réelle). */
export async function submitFeedback(
  state: E2eState,
  trackingId: string,
  note: number,
  comment?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${state.apiBase}/public/tickets/${trackingId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(comment ? { note, comment } : { note }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
