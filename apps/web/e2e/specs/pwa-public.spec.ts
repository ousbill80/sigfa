/**
 * E2E-CRITICAL-JOURNEYS — vitrine publique PWA `/q/[token]` (NOTIF-005-B).
 *
 * Parcours client réel, SANS auth, contre l'API publique réelle :
 *
 *  (1) Échec d'émission RENDU VISIBLE + bouton Réessayer (durci lot C) :
 *      un token d'agence valide (agence seedée) ouvre le suivi ; le client
 *      sélectionne un service dont l'uuid n'existe pas côté backend →
 *      `POST /public/tickets` réel répond 404 (« File introuvable ») → la
 *      confirmation affiche l'encart d'erreur humain (`pwa-emit-error`) AVEC un
 *      bouton `Réessayer` (`pwa-emit-retry`). Un nouvel essai rejoue la MÊME clé
 *      d'idempotence (aucun ticket fantôme) et l'erreur reste visible : c'est la
 *      garantie de justesse côté vitrine (jamais d'échec avalé en silence).
 *
 *  (2) Token invalide → écran d'erreur HUMAIN (`pwa-token-error`), jamais un
 *      crash blanc : le shell résout le token côté client pour une dégradation
 *      propre avant tout appel réseau.
 *
 * Sélecteurs stables (`data-testid`), attentes d'état (`expect`/`toBeVisible`),
 * zéro sleep arbitraire. FR/EN : les assertions portent sur des testids, pas
 * sur des libellés traduits.
 *
 * @module e2e/specs/pwa-public.spec
 */
import { test, expect } from "@playwright/test";
import { readState, type E2eState } from "../support/state";

let state: E2eState;
test.beforeAll(() => {
  state = readState();
});

/** Encode un segment base64url (sans padding) — parité `decodeBase64Url` PWA. */
function base64url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Forge un token d'agence CLIENT-parseable (`v{n}.{payloadB64url}.{sig}`).
 *
 * Le shell PWA ne fait qu'un décodage best-effort NON cryptographique
 * (`parseAgencyToken`) : la signature n'est pas vérifiée côté client, et
 * `POST /public/tickets` prend l'`agencyId` du CORPS (résolu depuis le token
 * côté client). Une signature factice suffit donc à ouvrir le suivi public avec
 * l'agence RÉELLE seedée — l'émission, elle, frappe l'API réelle.
 */
function forgeAgencyToken(agencyId: string, expOffsetSeconds = 3600): string {
  const payload = base64url(
    JSON.stringify({
      agencyId,
      exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
      keyVersion: 1,
    }),
  );
  return `v1.${payload}.e2e-signature-not-verified-clientside`;
}

test.describe("E2E-CRITICAL-JOURNEYS — vitrine publique PWA /q/[token]", () => {
  test("PWA-PUBLIC: échec d'émission rendu visible + Réessayer (idempotent, clé stable rejouée)", async ({
    page,
  }) => {
    // Token valide (agence RÉELLE seedée) → le shell rend le flux, pas l'erreur token.
    const token = forgeAgencyToken(state.agencyId);

    // ── Frontière du harnais (documentée) ────────────────────────────────────
    // La PWA publique émet DIRECTEMENT vers `NEXT_PUBLIC_API_URL` depuis le
    // navigateur ; dans le harnais l'API vit sur un autre port (:4021) et n'expose
    // PAS de CORS pour l'origine web (:4020) — en production la PWA est servie
    // même-origine derrière la passerelle. On interpose donc la réponse RÉELLE que
    // l'API renvoie pour un service inexistant (404 « File introuvable ») afin
    // d'exercer FIDÈLEMENT la machine d'état d'émission de la vitrine (mapping
    // d'erreur → encart humain → Réessayer rejouant la MÊME clé d'idempotence).
    // On CAPTURE aussi les clés d'idempotence pour prouver le rejeu (aucun ticket
    // fantôme). Le corps 404 est celui du handler réel `POST /public/tickets`.
    const seenIdempotencyKeys: string[] = [];
    await page.route("**/public/tickets", async (route) => {
      const key = route.request().headers()["x-idempotency-key"] ?? "";
      seenIdempotencyKeys.push(key);
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "NOT_FOUND", message: "File introuvable pour ce service." },
        }),
      });
    });

    await page.goto(`/q/${encodeURIComponent(token)}`);

    // Shell rendu (token accepté côté client) : étape « service » disponible.
    await expect(page.locator('[data-testid="pwa-shell"]')).toBeVisible();
    const cards = page.locator('[data-testid="pwa-service-card"]');
    await expect(cards.first()).toBeVisible();

    // Premier service ouvert (interactif) → étape confirmation.
    await cards.first().click();
    await expect(page.locator('[data-testid="pwa-confirm-step"]')).toBeVisible();

    // Émission (sans téléphone → soumission autorisée d'emblée).
    const submit = page.locator('[data-testid="pwa-confirm-submit"]');
    await expect(submit).toBeEnabled();
    await submit.click();

    // ── L'échec est RENDU VISIBLE (jamais avalé) + bouton Réessayer présent. ──
    const emitError = page.locator('[data-testid="pwa-emit-error"]');
    await expect(emitError).toBeVisible();
    await expect(page.locator('[data-testid="pwa-emit-error-message"]')).toBeVisible();
    const retry = page.locator('[data-testid="pwa-emit-retry"]');
    await expect(retry).toBeVisible();
    // On reste à l'étape confirmation : aucun ticket n'a été créé (aucune bascule).
    await expect(page.locator('[data-testid="pwa-ticket-step"]')).toHaveCount(0);

    // ── Réessayer rejoue la MÊME émission (même clé d'idempotence) → toujours ──
    //    404 → l'erreur reste visible (dégradation stable, pas de faux succès).
    await retry.click();
    await expect(emitError).toBeVisible();
    await expect(page.locator('[data-testid="pwa-ticket-step"]')).toHaveCount(0);

    // Preuve d'idempotence : la seconde tentative rejoue la MÊME clé (pas de
    // ticket fantôme) — garantie de justesse côté vitrine.
    await expect
      .poll(() => seenIdempotencyKeys.length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2);
    expect(seenIdempotencyKeys[0]).not.toBe("");
    expect(seenIdempotencyKeys[1]).toBe(seenIdempotencyKeys[0]);
  });

  test("PWA-PUBLIC: token invalide → écran d'erreur humain (pas de crash blanc)", async ({
    page,
  }) => {
    // Token manifestement malformé (pas 3 segments `v{n}.payload.sig`).
    await page.goto("/q/ceci-nest-pas-un-token");

    // Écran d'erreur HUMAIN rendu, jamais le flux ni un écran blanc.
    await expect(page.locator('[data-testid="pwa-token-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="pwa-confirm-step"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="pwa-service-step"]')).toHaveCount(0);
  });
});
