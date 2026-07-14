/**
 * E2E-CRITICAL-JOURNEYS-3 — insights IA + COMEX prédictif (IA-005).
 *
 * Parcours DIRECTION RÉEL (BANK_ADMIN ≥ AGENCY_DIRECTOR, scope agence) contre
 * l'API réelle (CONTRACT-008 : `GET /ai/forecast|/ai/anomalies|/ai/feedback-
 * insights` via le proxy same-origin `/api/rt`, Bearer injecté côté serveur).
 * Le front ne modélise ni ne score JAMAIS : il lit, dérive et EXPLIQUE.
 *
 * ## Comportement GATED réel (runtime, pas un mock)
 * La prévision d'affluence n'a de valeur qu'avec ≥ 90 j d'historique réel (seuil
 * CONTRACT-008). En l'absence de matérialisation `ai_features` (zone DB parallèle
 * hors périmètre), le provider par défaut renvoie `availableDays = 0` ⇒ l'API
 * répond **422 INSUFFICIENT_HISTORY** (`details: { requiredDays: 90,
 * availableDays: 0 }`). C'est le comportement de production ATTENDU tant que
 * l'historique pilote réel n'existe pas.
 *
 *  (a) ÉTAT PÉDAGOGIQUE FIRST-CLASS : le 422 sur N'IMPORTE QUEL endpoint IA n'est
 *      JAMAIS une erreur brute ni un graphe vide trompeur. Le tableau de bord rend
 *      l'état dédié `ai-insufficient` (rôle `status`) avec un compteur « X / 90
 *      jours » et une barre de progression `role="progressbar"` — un onboarding
 *      d'historique, pas un échec.
 *
 *  (b) PROGRESSION HONNÊTE : la jauge annonce `availableDays = 0` / `requiredDays
 *      = 90` (jamais un historique inventé). `aria-valuemin=0`, `aria-valuemax=90`,
 *      `aria-valuenow=0` : accessible et véridique.
 *
 *  (c) AUCUN APLAT `--danger` : l'état gated est rassurant (Design System §1,
 *      durci lot C). Ni `ai-error` (état d'échec) ni un pavé rouge : c'est un
 *      état d'attente pédagogique, pas une alarme. On vérifie l'ABSENCE de l'état
 *      d'erreur brut ET l'absence du dashboard nominal (les KpiTile ne sont rendus
 *      qu'avec des données suffisantes).
 *
 * Ce parcours n'emprunte PAS la couture socket-token TV (préexistante, hors
 * périmètre) : il exerce le pipeline REST IA de bout en bout.
 *
 * Sélecteurs stables (`data-testid`/ARIA), attentes d'état (`toPass`), zéro
 * sleep. FR/EN : assertions sur testids/ARIA, jamais sur libellés traduits.
 *
 * @module e2e/specs/insights.spec
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

test.describe("E2E-CRITICAL-JOURNEYS-3 — insights IA + COMEX (état gated réel)", () => {
  test("IA-005: 422 INSUFFICIENT_HISTORY rendu comme un état pédagogique first-class (zéro danger en aplat)", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await loginAsAdmin(context);
    const page = await context.newPage();
    await page.goto("/dashboard/insights");

    // ── (a) ÉTAT PÉDAGOGIQUE FIRST-CLASS : ni erreur brute, ni graphe vide. ────
    const insufficient = page.locator('[data-testid="ai-insufficient"]');
    await expect(insufficient).toBeVisible({ timeout: 20_000 });
    // C'est un état informatif (role="status"), pas une alerte d'erreur.
    await expect(insufficient).toHaveAttribute("role", "status");

    // La barre de progression d'historique est rendue (jamais un chart trompeur).
    const progress = insufficient.locator('[role="progressbar"]');
    await expect(progress).toBeVisible();

    // ── (b) PROGRESSION HONNÊTE : 0 / 90 jours (aucun historique inventé). ─────
    await expect(async () => {
      await expect(progress).toHaveAttribute("aria-valuemin", "0");
      await expect(progress).toHaveAttribute("aria-valuemax", "90");
      await expect(progress).toHaveAttribute("aria-valuenow", "0");
    }).toPass({ timeout: 15_000 });

    // ── (c) AUCUN APLAT DANGER : ni état d'échec brut, ni dashboard nominal. ───
    // L'état gated N'EST PAS l'état d'erreur (`ai-error`) : c'est une attente
    // pédagogique rassurante, pas une alarme rouge.
    await expect(page.locator('[data-testid="ai-error"]')).toHaveCount(0);
    // Le dashboard nominal (KpiTile COMEX / forecast) n'est PAS rendu sans données
    // suffisantes : aucune tuile de synthèse trompeuse.
    await expect(page.locator('[data-testid="ai-insights-dashboard"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ai-comex-predictive"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ai-forecast-peak"]')).toHaveCount(0);

    await context.close();
  });
});
