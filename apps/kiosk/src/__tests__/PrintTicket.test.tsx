/**
 * KIOSK-BORNE — Tests du ticket thermique 80 mm (PrintTicket).
 * Contenu complet (banque, agence, bienvenue, libellé opération, numéro,
 * attente humaine, suivi court, SMS conditionnel, courtoisie), accents
 * PARFAITS (le « esp¿ces » du modèle est le bug à éradiquer), masqué à
 * l'écran / seul visible en @media print.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";

vi.mock("next/navigation", () => ({
  useParams: () => ({ locale: "fr" }),
}));

import {
  PrintTicket,
  shortTrackingCode,
  SHORT_TRACKING_LENGTH,
} from "@/components/PrintTicket";

const frMessages = {
  print: {
    welcome: "Bienvenue à l'agence {agency}",
    yourNumber: "Votre numéro de passage",
    peopleAhead: "Personnes avant vous : {count}",
    estimatedWait: "Attente estimée : ~{minutes} min",
    trackingLabel: "Code de suivi : {code}",
    smsNotice: "Vous serez prévenu par SMS avant votre passage.",
    courtesy: "Merci de patienter, nous allons vous recevoir.",
  },
};

const baseProps = {
  bankName: "Banque Ivoire",
  agencyName: "Cocody Angré 9e Tranche",
  serviceLabel: "Retrait espèces",
  displayNumber: "P010",
  position: 6,
  estimatedWaitMinutes: 30,
  trackingId: "V9k2mXpLqRwZsYn8fBjH3",
  issuedAt: new Date("2026-07-13T13:57:00"),
};

function renderTicket(props: Partial<React.ComponentProps<typeof PrintTicket>> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      <PrintTicket {...baseProps} {...props} />
    </NextIntlClientProvider>
  );
}

describe("KIOSK-BORNE: PrintTicket — ticket thermique 80 mm", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it("KIOSK-BORNE: contenu complet dans l'ordre du modèle — banque, agence, date/heure, bienvenue, opération, numéro, attente", () => {
    renderTicket();

    expect(screen.getByTestId("print-bank").textContent).toBe("Banque Ivoire");
    expect(screen.getByTestId("print-agency").textContent).toBe("Cocody Angré 9e Tranche");
    expect(screen.getByTestId("print-date").textContent).toContain("2026");
    expect(screen.getByTestId("print-time").textContent).toMatch(/13[:h]57/);
    expect(screen.getByTestId("print-welcome").textContent).toBe(
      "Bienvenue à l'agence Cocody Angré 9e Tranche"
    );
    expect(screen.getByText("Votre numéro de passage")).toBeInTheDocument();
    expect(screen.getByTestId("print-service-label").textContent).toBe("Retrait espèces");
    expect(screen.getByTestId("print-number").textContent).toBe("P010");
    // Formats HUMAINS — jamais « 00:00:30 ».
    expect(screen.getByTestId("print-people-ahead").textContent).toBe(
      "Personnes avant vous : 6"
    );
    expect(screen.getByTestId("print-wait").textContent).toBe("Attente estimée : ~30 min");
    expect(screen.getByTestId("print-wait").textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("KIOSK-BORNE: accents PARFAITS — UTF-8 de bout en bout, zéro mojibake (bug « esp¿ces » éradiqué)", () => {
    const { container } = renderTicket();
    const text = container.textContent ?? "";
    expect(text).toContain("Retrait espèces");
    expect(text).toContain("Bienvenue à l'agence");
    expect(text).not.toContain("¿");
    expect(text).not.toContain("�");
    expect(text).not.toContain("esp¿ces");
  });

  it("KIOSK-BORNE: code de suivi COURT en texte (aucune route publique de suivi par trackingId → pas de QR)", () => {
    renderTicket();
    const tracking = screen.getByTestId("print-tracking").textContent ?? "";
    expect(tracking).toContain(shortTrackingCode("V9k2mXpLqRwZsYn8fBjH3"));
    expect(shortTrackingCode("V9k2mXpLqRwZsYn8fBjH3")).toHaveLength(SHORT_TRACKING_LENGTH);
    expect(shortTrackingCode("V9k2mXpLqRwZsYn8fBjH3")).toBe("V9K2MXPL");
  });

  it("KIOSK-BORNE: trackingId absent → aucune ligne de suivi (dégradation propre, ticket offline)", () => {
    renderTicket({ trackingId: undefined });
    expect(screen.queryByTestId("print-tracking")).not.toBeInTheDocument();
  });

  it("KIOSK-BORNE: mention SMS UNIQUEMENT si consentement donné + courtoisie toujours présente", () => {
    const { unmount } = renderTicket({ smsConsent: true });
    expect(screen.getByTestId("print-sms")).toBeInTheDocument();
    expect(screen.getByTestId("print-courtesy").textContent).toBe(
      "Merci de patienter, nous allons vous recevoir."
    );
    unmount();

    renderTicket({ smsConsent: false });
    expect(screen.queryByTestId("print-sms")).not.toBeInTheDocument();
    expect(screen.getByTestId("print-courtesy")).toBeInTheDocument();
  });

  it("KIOSK-BORNE: libellé opération absent (chemin conseiller) → ligne omise sans crash", () => {
    renderTicket({ serviceLabel: undefined });
    expect(screen.queryByTestId("print-service-label")).not.toBeInTheDocument();
    expect(screen.getByTestId("print-number").textContent).toBe("P010");
  });

  it("KIOSK-BORNE: layout thermique — masqué à l'écran, @page 80mm auto margin 0, seul visible en print", () => {
    const { container } = renderTicket();

    const root = screen.getByTestId("print-ticket");
    expect(root.className).toContain("sigfa-print-ticket");
    expect(root.getAttribute("aria-hidden")).toBe("true");

    const styleEl = container.querySelector("style");
    const css = styleEl?.textContent ?? "";
    expect(css).toContain("@page { size: 80mm auto; margin: 0; }");
    // Masqué à l'écran…
    expect(css).toContain(".sigfa-print-ticket { display: none; }");
    // …et SEUL rendu en @media print (largeur utile 72 mm).
    expect(css).toContain("@media print");
    expect(css).toContain("width: 72mm");
    expect(css).toContain('main[role="main"] > *:not(.sigfa-print-ticket) { display: none !important; }');
  });

  it("KIOSK-BORNE: monochrome thermique via tokens — var(--ink), aucun hex en dur, aucun emoji", () => {
    const { container } = renderTicket({ smsConsent: true });
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Zéro emoji (plage pictographique).
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
    const css = container.querySelector("style")?.textContent ?? "";
    expect(css).toContain("color: var(--ink)");
  });
});
