/**
 * KIOSK-005 — Tests de régression visuelle Playwright
 *
 * Captures RÉELLES FR/EN pour chaque écran :
 *   - HomeScreen (KIOSK-002)     → home-{locale}.png
 *   - ServicesScreen (KIOSK-003) → services-{locale}.png
 *   - TicketScreen (KIOSK-005)   → ticket-{locale}.png
 *
 * Résolution kiosk : 1024×768, animations désactivées (reduced-motion).
 * maxDiffPixelRatio : 0.002 (voir playwright.config.ts).
 *
 * Gate : local / RT-003 uniquement (Chromium requis).
 * Script : `pnpm test:visual` — EXCLU du script `test` standard.
 */
import { test, expect } from "@playwright/test";

const LOCALES = ["fr", "en"] as const;

/**
 * Paramètres ticket par défaut — KIOSK-005
 */
const TICKET_PARAMS = new URLSearchParams({
  displayNumber: "A007",
  position: "4",
  estimatedWaitMinutes: "12",
});

/**
 * Attend que le réseau soit inactif et que les animations
 * CSS soient terminées (ou désactivées via reduced-motion).
 */
async function waitForStable(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle");
  // Laisse React finir le rendu
  await page.waitForTimeout(500);
}

// ─── HomeScreen (KIOSK-002) ───────────────────────────────────────────────────

test.describe("KIOSK-002: HomeScreen — régression visuelle ×4 langues", () => {
  for (const locale of LOCALES) {
    test(`home-${locale}`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await waitForStable(page);

      // Vérifier que la page est chargée (titre présent)
      const main = page.locator("main[role='main']");
      await expect(main).toBeVisible();

      await expect(page).toHaveScreenshot(`home-${locale}.png`, {
        fullPage: false,
        clip: { x: 0, y: 0, width: 1024, height: 768 },
      });
    });
  }
});

// ─── ServicesScreen (KIOSK-003) ───────────────────────────────────────────────

test.describe("KIOSK-003: ServicesScreen — régression visuelle ×4 langues", () => {
  for (const locale of LOCALES) {
    test(`services-${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/services`);
      await waitForStable(page);

      const main = page.locator("main[role='main']");
      await expect(main).toBeVisible();

      await expect(page).toHaveScreenshot(`services-${locale}.png`, {
        fullPage: false,
        clip: { x: 0, y: 0, width: 1024, height: 768 },
      });
    });
  }
});

// ─── TicketScreen (KIOSK-005) ─────────────────────────────────────────────────

test.describe("KIOSK-005: TicketScreen — régression visuelle ×4 langues", () => {
  for (const locale of LOCALES) {
    test(`ticket-${locale}`, async ({ page }) => {
      // Bloquer speechSynthesis pour éviter le bruit audio/timing
      await page.addInitScript(() => {
        Object.defineProperty(window, "speechSynthesis", {
          value: {
            speak: () => {},
            cancel: () => {},
            pause: () => {},
            resume: () => {},
            getVoices: () => [],
            speaking: false,
            pending: false,
            paused: false,
            onvoiceschanged: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          },
          writable: false,
          configurable: true,
        });
        // Stub SpeechSynthesisUtterance
        (window as unknown as Record<string, unknown>)["SpeechSynthesisUtterance"] = class {
          constructor(public text: string) {}
          lang = "";
        };
      });

      await page.goto(`/${locale}/ticket?${TICKET_PARAMS.toString()}`);
      await waitForStable(page);

      // Vérifier le numéro de ticket
      const ticketNumber = page.locator("[data-testid='ticket-number']");
      await expect(ticketNumber).toBeVisible();
      await expect(ticketNumber).toHaveText("A007");

      await expect(page).toHaveScreenshot(`ticket-${locale}.png`, {
        fullPage: false,
        clip: { x: 0, y: 0, width: 1024, height: 768 },
        // Audit F9 : le compte à rebours change chaque seconde → masqué pour
        // la stabilité du snapshot (le reste de l'écran reste comparé).
        mask: [page.locator("[data-testid='ticket-returning']")],
      });
    });
  }
});

// ─── Moment Ticket — gabarit sain 1024×768 ET 1920×1080 (audit F4) ───────────

const TICKET_OFFLINE_PARAMS = new URLSearchParams({
  trackingId: "9d3a2f30-6b1c-4c8e-9f4a-1b2c3d4e5f60",
  displayNumber: "H001",
  position: "1",
  estimatedWaitMinutes: "0",
});

const VIEWPORTS = [
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1920x1080", width: 1920, height: 1080 },
] as const;

/** Stub speechSynthesis (identique au bloc ticket ci-dessus). */
async function stubSpeech(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: () => {},
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        getVoices: () => [],
        speaking: false,
        pending: false,
        paused: false,
        onvoiceschanged: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      },
      writable: false,
      configurable: true,
    });
    (window as unknown as Record<string, unknown>)["SpeechSynthesisUtterance"] = class {
      constructor(public text: string) {}
      lang = "";
    };
  });
}

test.describe("KIOSK-005b (audit F4): Moment Ticket — zéro chevauchement, zéro scroll", () => {
  for (const viewport of VIEWPORTS) {
    for (const scenario of [
      { name: "nominal", params: TICKET_PARAMS },
      { name: "offline", params: TICKET_OFFLINE_PARAMS },
    ] as const) {
      test(`ticket-${scenario.name}-${viewport.name}`, async ({ page }) => {
        await stubSpeech(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`/fr/ticket?${scenario.params.toString()}`);
        await waitForStable(page);

        // Zéro scroll : tout le Moment Ticket tient dans le viewport.
        const scrollHeight = await page.evaluate(
          () => document.scrollingElement?.scrollHeight ?? 0
        );
        expect(scrollHeight).toBeLessThanOrEqual(viewport.height);

        // Zéro chevauchement : la carte héros et chaque ligne sous la carte
        // occupent des bandes verticales disjointes, toutes dans le viewport.
        const card = await page.locator("section.sig-ticket").boundingBox();
        expect(card).not.toBeNull();
        expect(card!.y).toBeGreaterThanOrEqual(0);

        const belowSelectors = [
          "[data-testid='ticket-position']",
          "[data-testid='ticket-offline-info']",
          "[data-testid='print-message']",
          "[data-testid='ticket-countdown-row']",
        ];
        let previousBottom = card!.y + card!.height;
        for (const selector of belowSelectors) {
          const el = page.locator(selector);
          if ((await el.count()) === 0) continue;
          const box = await el.boundingBox();
          expect(box, `boundingBox ${selector}`).not.toBeNull();
          // Pas de superposition avec l'élément précédent (bande disjointe).
          expect(box!.y, `chevauchement ${selector}`).toBeGreaterThanOrEqual(
            previousBottom - 1
          );
          // Visible au-dessus de la ligne de flottaison.
          expect(box!.y + box!.height, `sous le pli ${selector}`).toBeLessThanOrEqual(
            viewport.height
          );
          previousBottom = box!.y + box!.height;
        }

        // F5 : le chemin offline est honnête, le nominal ne l'évoque jamais.
        const offlineBanner = page.locator("[data-testid='offline-banner']");
        if (scenario.name === "offline") {
          await expect(offlineBanner).toBeVisible();
          await expect(page.locator("[data-testid='ticket-position']")).toHaveCount(0);
        } else {
          await expect(offlineBanner).toHaveCount(0);
        }
      });
    }
  }
});
