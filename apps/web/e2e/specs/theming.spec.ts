/**
 * E2E-CRITICAL-JOURNEYS — console theming banque (ADM-001b).
 *
 * Parcours administrateur RÉEL (BANK_ADMIN, scope banque) contre l'API réelle
 * (`GET`/`PATCH /banks/:id/theme` via le proxy same-origin `/api/rt`) :
 *
 *  (a) La console charge le thème seedé (état `ready`) — preview live rendue.
 *  (b) Brander avec une couleur à FAIBLE contraste sur fond clair → l'encart de
 *      contraste WCAG signale l'échec (`preview-contrast-warning`) ET affiche la
 *      couleur APPLIQUÉE auto-corrigée (`preview-applied-brand`) : le `--brand`
 *      unique + contraste auto (≥ 4.5:1) est garanti côté vitrine admin.
 *  (c) Brander avec une couleur à FORT contraste → l'encart passe au vert
 *      (`preview-contrast-pass`) : la preview live reflète le changement sans
 *      rechargement de page.
 *  (d) Enregistrer → PATCH réel persiste et l'accusé `adm-theme-saved` s'affiche.
 *
 * Sélecteurs stables (`data-testid`), attentes d'état, zéro sleep arbitraire.
 * FR/EN : assertions sur testids, jamais sur libellés traduits.
 *
 * @module e2e/specs/theming.spec
 */
import { test, expect } from "@playwright/test";
import { readState, type E2eState } from "../support/state";

let state: E2eState;
test.beforeAll(() => {
  state = readState();
});

/** Pose le cookie httpOnly BANK_ADMIN (le layout serveur dérive bankId/rôle). */
async function loginAsAdmin(
  context: import("@playwright/test").BrowserContext,
): Promise<void> {
  await context.addCookies([
    {
      name: "access_token",
      value: state.adminToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test.describe("E2E-CRITICAL-JOURNEYS — console theming banque", () => {
  test("THEMING: brand + preview live + contraste WCAG auto + save, contre l'API réelle", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await loginAsAdmin(context);
    const page = await context.newPage();
    await page.goto("/admin/theming");

    // ── (a) Console chargée (thème seedé → état ready), preview live rendue. ──
    await expect(page.locator('[data-testid="theming-console"]')).toBeVisible();
    await expect(page.locator('[data-testid="theming-preview"]')).toBeVisible();

    const hex = page.locator('[data-testid="adm-brand-hex"]');
    const save = page.locator('[data-testid="adm-theme-save"]');

    // ── (b) Couleur à FAIBLE contraste sur fond clair → avertissement WCAG + ──
    //        couleur APPLIQUÉE auto-corrigée affichée (contraste auto).
    await hex.fill("#ffd400"); // jaune vif : < 4.5:1 sur blanc
    await expect(page.locator('[data-testid="preview-contrast-warning"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-applied-brand"]')).toBeVisible();
    // Pas de badge « conforme » tant que la couleur brute échoue.
    await expect(page.locator('[data-testid="preview-contrast-pass"]')).toHaveCount(0);

    // ── (c) Couleur à FORT contraste → l'encart passe au vert (preview live). ──
    await hex.fill("#003f7f"); // bleu marine : ≥ 4.5:1 sur blanc
    await expect(page.locator('[data-testid="preview-contrast-pass"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-contrast-warning"]')).toHaveCount(0);
    // Le ratio conforme est affiché.
    await expect(page.locator('[data-testid="preview-contrast-ratio"]')).toBeVisible();

    // ── (d) Enregistrer → PATCH réel persiste, accusé de sauvegarde affiché. ──
    await save.click();
    await expect(page.locator('[data-testid="adm-theme-saved"]')).toBeVisible();
    // Aucune erreur serveur remontée.
    await expect(page.locator('[data-testid="adm-theme-server-error"]')).toHaveCount(0);

    await context.close();
  });
});
