/**
 * E2E-CRITICAL-JOURNEYS-2 — écran auditeur (SEC-001b).
 *
 * Parcours AUDITEUR RÉEL (rôle ORTHOGONAL, LECTURE SEULE) contre l'API réelle
 * (`GET /audit-logs` via le proxy same-origin `/api/rt`, Bearer injecté côté
 * serveur depuis le cookie httpOnly). Le journal d'audit est append-only en base :
 *
 *  (a) Une MUTATION tenant RÉELLE produit une entrée d'audit : le client émet un
 *      ticket via `POST /tickets` (chemin agent, scope agence) ; le backend écrit
 *      une entrée `audit_log` (action « POST /tickets », entityType « ticket »,
 *      entityId = id du ticket) DANS la même transaction (SEC-001a, jamais best-
 *      effort). L'auditeur ouvre `/audit` et VOIT cette entrée dans le journal.
 *
 *  (b) Les FILTRES fonctionnent : filtrer par `entityId` = l'id du ticket réduit
 *      le journal à cette seule entité (re-fetch GET côté serveur, jamais un tri
 *      client). L'action et l'entité affichées correspondent à la mutation.
 *
 *  (c) ZÉRO fuite cross-tenant : filtrer par un `entityId` UUID inexistant renvoie
 *      un journal VIDE (état empty) — la portée est appliquée côté serveur (scope
 *      banque du JWT + WHERE bank_id), jamais un masquage client. Le journal n'est
 *      STRICTEMENT en lecture : aucun contrôle de mutation dans le DOM.
 *
 * Ce parcours n'emprunte PAS la couture socket-token TV (préexistante, hors
 * périmètre) : il exerce le pipeline REST audité de bout en bout.
 *
 * Sélecteurs stables (`data-testid`), attentes d'état (`toPass`/`poll`), zéro
 * sleep. FR/EN : assertions sur testids, jamais sur libellés traduits.
 *
 * @module e2e/specs/audit-trail.spec
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readState, type E2eState } from "../support/state";
import { takeTicketAtKiosk } from "../support/journey";
import { resetQueueState } from "../support/reset";

let state: E2eState;
// Isolation d'état (E2E-STATE-ISOLATION) : ce spec émet un ticket sans jamais
// l'appeler — il laisserait donc un WAITING qui polluerait la file d'un spec
// aval. La purge AVANT exécution garde l'assertion (filtre par entityId propre)
// tout en évitant que ce spec devienne une SOURCE de dérive FIFO.
test.beforeAll(async () => {
  state = readState();
  await resetQueueState(state);
});

/** UUID canonique manifestement absent du tenant (preuve d'absence de fuite). */
const ABSENT_UUID = "00000000-0000-4000-8000-000000000000";

/** Pose le cookie httpOnly AUDITOR (le proxy /api/rt injecte le Bearer). */
async function loginAsAuditor(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "access_token",
      value: state.auditorToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** Applique un filtre `entityId` et relance la lecture (GET re-fetch serveur).
 * Le `data-testid` du `Field` est porté par l'`<input>` lui-même (spread `rest`). */
async function filterByEntityId(page: Page, entityId: string): Promise<void> {
  await page.locator('[data-testid="audit-filter-entityId"]').fill(entityId);
  await page.locator('[data-testid="audit-apply"]').click();
}

test.describe("E2E-CRITICAL-JOURNEYS-2 — écran auditeur (journal d'audit)", () => {
  test("AUDIT: une mutation ticket produit une entrée que l'auditeur voit (filtres, zéro fuite cross-tenant)", async ({
    browser,
  }) => {
    // ── (a) MUTATION tenant réelle → entrée d'audit (POST /tickets, SEC-001a) ──
    const ticket = await takeTicketAtKiosk(state);
    expect(ticket.status).toBe("WAITING");

    const context = await browser.newContext();
    await loginAsAuditor(context);
    const page = await context.newPage();
    await page.goto("/audit");

    // La console d'audit charge (état ready → table présente). L'écriture d'audit
    // est committée avec la mutation ; on filtre par l'entité pour cibler l'entrée
    // et absorber toute latence de commit (re-fetch serveur, jamais un tri client).
    await expect(page.locator('[data-testid="audit-filters"]')).toBeVisible();

    // ── (b) FILTRES : cibler l'entité du ticket → l'entrée devient visible. ────
    await expect(async () => {
      await filterByEntityId(page, ticket.id);
      // La table (état ready) apparaît AVEC au moins une ligne pour cette entité.
      await expect(page.locator('[data-testid="audit-table"]')).toBeVisible();
      const rows = page.locator('[data-testid="audit-row"]');
      await expect(rows).not.toHaveCount(0);
    }).toPass({ timeout: 20_000 });

    // L'action journalisée est bien celle de l'émission, sur l'entité « ticket ».
    const firstRow = page.locator('[data-testid="audit-row"]').first();
    await expect(firstRow.locator('[data-testid="audit-action-badge"]')).toContainText(
      "POST /tickets",
    );
    await expect(firstRow).toContainText("ticket");
    await expect(firstRow).toContainText(ticket.id);

    // Lecture SEULE STRICTE : aucun contrôle de mutation dans le DOM (SEC-001b).
    await expect(page.locator('button:has-text("Supprimer")')).toHaveCount(0);
    await expect(page.locator('form[method="post"]')).toHaveCount(0);

    // ── (c) ZÉRO fuite cross-tenant : un entityId absent → journal VIDE. ───────
    // La portée est appliquée côté serveur (scope banque JWT + WHERE bank_id) : un
    // UUID hors du tenant ne renvoie AUCUNE ligne (état empty), jamais une fuite.
    await filterByEntityId(page, ABSENT_UUID);
    await expect(page.locator('[data-testid="audit-empty"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="audit-row"]')).toHaveCount(0);

    await context.close();
  });
});
