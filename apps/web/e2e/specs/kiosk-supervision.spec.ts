/**
 * E2E-CRITICAL-JOURNEYS-2 — supervision des bornes (ADM-003b).
 *
 * Parcours SUPERVISION RÉEL (BANK_ADMIN, scope banque + agence) contre l'API
 * réelle (`GET /agencies/{id}/kiosks/status` via le proxy same-origin `/api/rt`).
 * Le statut de CHAQUE borne est DÉRIVÉ À LA LECTURE depuis `last_seen` + l'horloge
 * serveur (seuil SILENT = 90 s) — jamais un état figé. Le harnais seede des
 * horodatages contrôlés : une borne MUETTE (dernier heartbeat il y a 10 min) et
 * une borne EN LIGNE (5 s) :
 *
 *  (a) DÉTECTION borne silencieuse : la borne muette apparaît dans la grille avec
 *      le statut `SILENT` (pastille `--danger` bordée, jamais un pavé rouge plein)
 *      et remonte EN TÊTE (tri par sévérité, pire en haut).
 *
 *  (b) ALERTE MUETTE en staff room : le compteur d'alertes actives est > 0 et
 *      rendu comme un `Badge` visuel (icône point + texte appariés) — AUCUNE
 *      alarme SONORE (zéro `<audio>` dans le DOM : l'alerte ne réveille pas
 *      l'agence, elle se voit). Preuve : le DOM ne contient aucun élément audio.
 *
 *  (c) REFLET écran agence/réseau : la vue réseau (BANK_ADMIN+) recense l'agence
 *      détentrice d'≥ 1 borne muette (rollup par agence, ordonné par sévérité).
 *
 * Ce parcours n'emprunte PAS la couture socket-token TV (préexistante, hors
 * périmètre) : l'état initial vient du SNAPSHOT REST (`refresh` initial), le socket
 * ne fait qu'entretenir la fraîcheur. Aucune dépendance à un événement live.
 *
 * Sélecteurs stables (`data-testid`), attentes d'état (`toPass`), zéro sleep.
 * FR/EN : assertions sur testids, jamais sur libellés traduits.
 *
 * @module e2e/specs/kiosk-supervision.spec
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { readState, type E2eState } from "../support/state";

let state: E2eState;
test.beforeAll(() => {
  state = readState();
});

/** Pose le cookie httpOnly BANK_ADMIN (network view activée + scope agence). */
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

test.describe("E2E-CRITICAL-JOURNEYS-2 — supervision des bornes", () => {
  test("ADM-003: borne muette détectée → alerte MUETTE (pas de son) + reflet vue réseau", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await loginAsAdmin(context);
    const page = await context.newPage();
    await page.goto("/admin/kiosks");

    // ── (a) DÉTECTION : la grille se peuple depuis le snapshot REST ; la borne ─
    //        muette (seedée last_seen -10 min) est dérivée SILENT.
    await expect(page.locator('[data-testid="kiosk-supervision"]')).toBeVisible({
      timeout: 20_000,
    });
    const silentCard = page.locator('[data-testid="kiosk-card"][data-status="SILENT"]');
    await expect(async () => {
      await expect(silentCard).not.toHaveCount(0);
    }).toPass({ timeout: 20_000 });
    // La pastille de statut de la borne muette est présente (danger, bordée).
    await expect(
      silentCard.first().locator('[data-testid="kiosk-status-pill"]'),
    ).toBeVisible();
    // Tri par sévérité : la borne muette (pire) est la PREMIÈRE tuile de la grille.
    await expect(
      page.locator('[data-testid="kiosk-grid"] [data-testid="kiosk-card"]').first(),
    ).toHaveAttribute("data-status", "SILENT");

    // La borne EN LIGNE seedée est aussi rendue (snapshot complet, pas qu'un état).
    await expect(
      page.locator('[data-testid="kiosk-card"][data-status="ONLINE"]'),
    ).not.toHaveCount(0);

    // ── (b) ALERTE MUETTE : compteur d'alertes > 0, rendu VISUEL, ZÉRO son. ────
    const alertCounter = page.locator('[data-testid="alert-counter"]');
    await expect(alertCounter).toBeVisible();
    // Le compteur reflète ≥ 1 borne muette (badge à point + texte appariés).
    await expect(alertCounter).not.toContainText(/^\s*0\s/);
    // AUCUNE alarme sonore : le DOM ne contient aucun élément audio (alerte muette).
    await expect(page.locator("audio")).toHaveCount(0);

    // ── (c) REFLET RÉSEAU : bascule vue réseau → l'agence détentrice remonte. ──
    // Le SegmentedControl est un `radiogroup` : l'option « Vue réseau » est un
    // `role="radio"` dont le nom accessible est le libellé (FR « Vue réseau »).
    await page.getByRole("radio", { name: /réseau|network/i }).click();
    await expect(page.locator('[data-testid="network-view"]')).toBeVisible();
    const agencyRow = page.locator('[data-testid="network-agency-row"]');
    await expect(agencyRow).not.toHaveCount(0);
    // La ligne réseau cible l'agence seedée (id en méta) et compte ≥ 1 muette.
    await expect(agencyRow.first()).toContainText(state.agencyId);
    // La vue réseau n'affiche PAS l'état « aucune borne muette » (il y en a une).
    await expect(page.locator('[data-testid="network-no-silent"]')).toHaveCount(0);

    await context.close();
  });
});
