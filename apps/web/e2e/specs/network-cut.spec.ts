/**
 * RT-003 — Coupure réseau mi-parcours (critère 2).
 *
 * QUAND une coupure réseau est simulée mi-parcours (offline navigateur) ALORS
 * les surfaces dégradent proprement (bandeau offline F4) puis, au retour,
 * RESYNCHRONISENT (sync:state) sans perte du ticket en cours — assertion sur
 * l'écran final cohérent (convergence d'état, D4 : snapshot, pas rejeu).
 *
 * @module e2e/specs/network-cut.spec
 */
import { test, expect } from "@playwright/test";
import { readState, type E2eState } from "../support/state";
import { takeTicketAtKiosk } from "../support/journey";
import { resetQueueState } from "../support/reset";

let state: E2eState;
// Isolation d'état (E2E-STATE-ISOLATION) : purge la file partagée AVANT ce
// parcours (deux tickets émis ici, t1/t2) afin que les deux `call-next`
// successifs servent t1 puis t2, jamais un ticket WAITING résiduel (dérive FIFO).
test.beforeAll(async () => {
  state = readState();
  await resetQueueState(state);
});

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

test.describe("RT-003 — coupure réseau + resync", () => {
  test("RT-003: coupure réseau mi-parcours → dégradation offline puis resync sans perte, écran final cohérent", async ({
    browser,
  }) => {
    // Deux tickets en file : un appelé avant la coupure, un pendant.
    const t1 = await takeTicketAtKiosk(state);
    const t2 = await takeTicketAtKiosk(state);
    const d1 = t1.number.replace(/\D/g, "");
    const d2 = t2.number.replace(/\D/g, "");

    // ── TV en ligne sur la VRAIE route par agence ─────────────────────────────
    // `/tv/{agencyId}` (PUBLIC, S2) minte son token DISPLAY (POST /tv/session)
    // puis rejoint la room `agency:{id}` : socket réel, aucun cookie/JWT agent.
    const tvContext = await browser.newContext();
    const tv = await tvContext.newPage();
    await tv.goto(`/tv/${state.agencyId}`);
    await expect(tv.locator('[data-testid="tv-root"]')).toHaveAttribute(
      "data-realtime",
      "on"
    );

    // ── Agent : appelle t1 → TV affiche l'appel réel ─────────────────────────
    const agentContext = await browser.newContext();
    await loginAsAgent(agentContext);
    const agent = await agentContext.newPage();
    await agent.goto("/agent");
    await agent.locator('[data-testid="agent-call-next"]').click();
    await expect(async () => {
      await expect(tv.locator('[data-testid="tv-hero-number"]')).toContainText(d1);
    }).toPass({ timeout: 20_000 });

    // ── COUPURE RÉSEAU mi-parcours (offline navigateur sur la surface TV) ──────
    await tvContext.setOffline(true);
    // Dégradation : bandeau offline visible (état offline F4), dernier appel
    // conservé à l'écran (pas d'écran blanc).
    await expect(tv.locator('[data-testid="tv-offline-banner"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(tv.locator('[data-testid="tv-hero-number"]')).toContainText(d1);

    // ── Pendant la coupure : l'agent clôture t1 et appelle t2 (API réelle) ─────
    await agent.locator('[data-testid="agent-finish"]').click();
    await expect(agent.locator('[data-testid="agent-ticket-empty"]')).toBeVisible();
    await agent.locator('[data-testid="agent-call-next"]').click();
    await expect(agent.locator('[data-testid="agent-ticket-number"]')).toContainText(d2);

    // ── RETOUR RÉSEAU → resync (sync:state snapshot) sans perte ────────────────
    await tvContext.setOffline(false);

    // Convergence d'état : après resync, l'écran final reflète l'état serveur —
    // le dernier appelé (t2) est en héros, la connexion est rétablie.
    await expect(async () => {
      await expect(tv.locator('[data-testid="tv-hero-number"]')).toContainText(d2);
    }).toPass({ timeout: 30_000 });
    await expect(tv.locator('[data-testid="tv-offline-banner"]')).toHaveCount(0);
    // Le ticket en cours n'est PAS perdu : écran final cohérent (état nominal).
    await expect(tv.locator('[data-testid="tv-screen"]')).toHaveAttribute(
      "data-state",
      "nominal"
    );

    await tvContext.close();
    await agentContext.close();
  });
});
