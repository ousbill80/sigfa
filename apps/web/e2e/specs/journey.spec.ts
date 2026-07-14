/**
 * RT-003 — Parcours complet réel de bout en bout (critère 1).
 *
 * (a) client prend un ticket à la borne (POST /tickets réel → WAITING + trackingId),
 * (b) l'écran TV affiche l'appel quand l'AGENT appelle le suivant depuis son
 *     dashboard (ticket:called RÉEL via socket.io),
 * (c) l'agent SERT puis CLÔTURE (serve → close réels),
 * (d) le client laisse un FEEDBACK (suivi public par trackingId réel).
 *
 * Contre l'API + sockets RÉELS (Testcontainers PG16/Redis7, REALTIME_MODE=real),
 * jamais le mock.
 *
 * @module e2e/specs/journey.spec
 */
import { test, expect } from "@playwright/test";
import { readState, type E2eState } from "../support/state";
import { takeTicketAtKiosk, submitFeedback, trackTicket } from "../support/journey";

let state: E2eState;
test.beforeAll(() => {
  state = readState();
});

/** Pose le cookie httpOnly agent (le proxy /api/rt injecte le Bearer). */
async function loginAsAgent(context: import("@playwright/test").BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "access_token",
      value: state.agentToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("RT-003 — parcours réel bout-en-bout", () => {
  test("RT-003: borne→appel TV→service agent→feedback vert contre l'API + sockets réels", async ({
    browser,
  }) => {
    // ── (a) BORNE : le client prend un ticket (API réelle) ────────────────────
    const ticket = await takeTicketAtKiosk(state);
    expect(ticket.status).toBe("WAITING");
    expect(ticket.trackingId).toHaveLength(21);
    const digits = ticket.number.replace(/\D/g, ""); // "A001" → "001"

    // ── ÉCRAN TV : ouvre l'affichage temps réel de la VRAIE route par agence ────
    // `/tv/{agencyId}` est PUBLIC (S2) : la page minte elle-même un token DISPLAY
    // (POST /tv/session { agencyId }, via le proxy same-origin /api/rt) puis le
    // passe au handshake socket → join `agency:{id}` → reçoit ticket:called /
    // sync:state. AUCUN cookie/JWT agent ici (le token DISPLAY est par-agence).
    const tvContext = await browser.newContext();
    const tv = await tvContext.newPage();
    await tv.goto(`/tv/${state.agencyId}`);
    // Le socket réel est actif (mode real câblé par le layout serveur).
    await expect(tv.locator('[data-testid="tv-root"]')).toHaveAttribute(
      "data-realtime",
      "on"
    );
    // Avant tout appel : pas de héros (état empty).
    await expect(tv.locator('[data-testid="tv-screen"]')).toHaveAttribute(
      "data-state",
      "empty"
    );

    // ── (b) AGENT : appelle le suivant depuis son dashboard (socket réel) ──────
    const agentContext = await browser.newContext();
    await loginAsAgent(agentContext);
    const agent = await agentContext.newPage();
    await agent.goto("/agent");
    await agent.locator('[data-testid="agent-call-next"]').click();

    // L'agent sert le ticket appelé (zone ticket alimentée par la réponse réelle).
    await expect(agent.locator('[data-testid="agent-ticket-number"]')).toContainText(
      digits
    );

    // ── L'ÉCRAN TV affiche l'appel (ticket:called RÉEL) ───────────────────────
    // Attente robuste : la propagation socket est asynchrone (toPass + poll).
    await expect(async () => {
      await expect(tv.locator('[data-testid="tv-hero-number"]')).toContainText(digits);
    }).toPass({ timeout: 20_000 });
    await expect(tv.locator('[data-testid="tv-screen"]')).toHaveAttribute(
      "data-state",
      "nominal"
    );

    // ── (c) AGENT : sert puis clôture (serve → close réels) ────────────────────
    await agent.locator('[data-testid="agent-finish"]').click();
    // Zone ticket réinitialisée après clôture.
    await expect(agent.locator('[data-testid="agent-ticket-empty"]')).toBeVisible();

    // Le ticket est bien DONE côté API réelle (précondition du feedback public).
    await expect(async () => {
      const tracked = await trackTicket(state, ticket.trackingId);
      expect(tracked.status).toBe(200);
      expect((tracked.body as { status?: string }).status).toBe("DONE");
    }).toPass({ timeout: 15_000 });

    // ── (d) CLIENT : laisse un feedback (suivi public par trackingId) ──────────
    const fb = await submitFeedback(state, ticket.trackingId, 5, "Service rapide");
    expect(fb.status).toBe(201);
    expect((fb.body as { success?: boolean }).success).toBe(true);

    await tvContext.close();
    await agentContext.close();
  });
});
