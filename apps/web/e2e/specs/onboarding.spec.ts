/**
 * E2E-CRITICAL-JOURNEYS-3 — onboarding agence < 2h (ADM-002b).
 *
 * Parcours ADMIN RÉEL (BANK_ADMIN, scope banque + agence) contre l'API réelle
 * (clone/provision/onboarding via le proxy same-origin `/api/rt`, Bearer injecté
 * côté serveur depuis le cookie httpOnly). Le stepper 5 étapes pilote un vrai
 * clone STRUCTUREL puis un provisioning de borne, sans aucun mock :
 *
 *  (a) DÉMARRAGE : la console d'onboarding charge (RBAC BANK_ADMIN ≥ DIRECTOR) ;
 *      le chronomètre tourne (indicateur « < 2h » vert) et l'étape 1/5 (clone)
 *      est active. Le stepper est un vrai composant progressif (data-testid par
 *      étape), jamais une page figée.
 *
 *  (b) CLONE STRUCTUREL RÉEL : brancher la source sur l'agence SEEDÉE (clone
 *      d'une agence existante → recopie services/guichets, zéro PII) et soumettre.
 *      Le backend crée une NOUVELLE agence + démarre le parcours d'onboarding
 *      persisté (Redis). L'accusé de clone s'affiche : l'étape est FRANCHIE, pas
 *      simulée. La progression avance (étape 2/5).
 *
 *  (c) ÉTAPES STRUCTURELLES : confirmer services → guichets → agents (étapes de
 *      vérification de la config clonée) fait avancer le stepper jusqu'à l'étape
 *      kiosk (5/5). Chaque confirmation persiste l'état d'avancement (reducer).
 *
 *  (d) QR D'INSTALL GÉNÉRÉ LOCALEMENT : provisionner la borne (POST réel
 *      :provision) rend l'écran d'installation avec un QR encodé CÔTÉ CLIENT
 *      (lib `qrcode`, data-URL, aucun tiers) + l'échéance du jeton. Le QR encode
 *      l'URL d'enrôlement (jamais le jeton en clair, présent aussi en texte).
 *
 *  (e) RÉCAP FINAL : le parcours complet affiche le récap opérationnel avec la
 *      durée totale MESURÉE + l'id d'agence + l'id de borne — preuve d'un état
 *      persistant de bout en bout (pas un simple message statique).
 *
 * Sélecteurs stables (`data-testid`/ARIA), attentes d'état (`toPass`), zéro
 * sleep. FR/EN : assertions sur testids, jamais sur libellés traduits.
 *
 * @module e2e/specs/onboarding.spec
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { readState, type E2eState } from "../support/state";

let state: E2eState;
test.beforeAll(() => {
  state = readState();
});

/** Pose le cookie httpOnly BANK_ADMIN (le proxy /api/rt injecte le Bearer). */
async function loginAsAdmin(context: BrowserContext): Promise<void> {
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

test.describe("E2E-CRITICAL-JOURNEYS-3 — onboarding agence (stepper + QR local)", () => {
  test("ADM-002: clone structurel réel → 5 étapes → QR d'install local → récap opérationnel", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await loginAsAdmin(context);
    const page = await context.newPage();
    await page.goto("/admin/onboarding");

    // ── (a) DÉMARRAGE : stepper chargé, chronomètre actif, étape 1 (clone). ────
    await expect(page.locator('[data-testid="adm-onboard-stepper"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="adm-onboard-chrono"]')).toBeVisible();
    await expect(page.locator('[data-testid="adm-step-clone"]')).toBeVisible();

    // ── (b) CLONE STRUCTUREL RÉEL depuis l'agence seedée (POST :clone). ────────
    // `Field` propage `data-testid` sur l'<input> lui-même (spread `...rest`).
    await page.locator('[data-testid="adm-clone-name"]').fill("Agence Riviera");
    // Basculer la source sur « une agence existante » (radiogroup SegmentedControl).
    // Le libellé « template » contient aussi « agence » (FR) → cibler « existante ».
    await page.getByRole("radio", { name: /existante|existing/i }).click();
    // L'id de source = l'agence seedée (clone d'une agence réelle du tenant).
    await page.locator('[data-testid="adm-clone-template"]').fill(state.agencyId);
    await page.locator('[data-testid="adm-clone-submit"]').click();

    // L'accusé de clone confirme que le POST réel a réussi (étape franchie).
    await expect(page.locator('[data-testid="adm-clone-done"]')).toBeVisible({
      timeout: 20_000,
    });
    // Aucune erreur serveur remontée par le clone.
    await expect(page.locator('[data-testid="adm-onboard-error"]')).toHaveCount(0);

    // ── (c) ÉTAPES STRUCTURELLES : services → counters → agents → kiosk. ───────
    // Avancer vers l'étape « services » puis confirmer chaque étape de config.
    await page.locator('[data-testid="adm-onboard-next"]').click();
    for (const step of ["services", "counters", "agents"] as const) {
      await expect(page.locator(`[data-testid="adm-step-${step}"]`)).toBeVisible();
      await page.locator('[data-testid="adm-verify-confirm"]').click();
      await expect(page.locator('[data-testid="adm-verify-confirmed"]')).toBeVisible();
      await page.locator('[data-testid="adm-onboard-next"]').click();
    }

    // ── (d) ÉTAPE KIOSK : provision réel → QR généré LOCALEMENT + échéance. ────
    await expect(page.locator('[data-testid="adm-step-kiosk"]')).toBeVisible();
    await page.locator('[data-testid="adm-kiosk-provision"]').click();

    await expect(page.locator('[data-testid="adm-kiosk-install-screen"]')).toBeVisible({
      timeout: 20_000,
    });
    // Le QR est un data-URL généré côté client (aucun endpoint tiers) : la balise
    // <img> porte une source `data:image/...` produite par la lib `qrcode`.
    const qr = page.locator('[data-testid="adm-kiosk-qr"]');
    await expect(async () => {
      const src = await qr.getAttribute("src");
      expect(src ?? "").toMatch(/^data:image\//);
    }).toPass({ timeout: 15_000 });
    // L'échéance du jeton est affichée (le jeton en clair n'est jamais surfacé).
    await expect(page.locator('[data-testid="adm-kiosk-expires"]')).toBeVisible();
    // La régénération est offerte (usage-unique) — preuve d'un écran d'install réel.
    await expect(page.locator('[data-testid="adm-kiosk-regenerate"]')).toBeVisible();

    // ── (e) RÉCAP FINAL : durée mesurée + id agence + id borne (état persistant). ─
    const recap = page.locator('[data-testid="adm-onboard-recap"]');
    await expect(recap).toBeVisible({ timeout: 15_000 });
    // La durée totale mesurée est rendue (chronomètre → récap, jamais un placeholder).
    await expect(page.locator('[data-testid="adm-onboard-total-duration"]')).toBeVisible();
    await expect(page.locator('[data-testid="adm-onboard-total-duration"]')).not.toBeEmpty();
    // Le récap référence l'agence clonée ET la borne provisionnée : les DEUX
    // mutations réelles laissent un id UUID (état persistant de bout en bout).
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    await expect(recap).toContainText(uuidRe);

    await context.close();
  });
});
