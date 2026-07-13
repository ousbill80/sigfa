/**
 * Tests for ThemingConsole (ADM-001b).
 *
 * Covers: RBAC (BANK_ADMIN/AGENCY_DIRECTOR reach it; AGENT/MANAGER/AUDITOR →
 * forbidden), the « habillage jamais structure » notice, the ABSENCE of any
 * layout/structure control, live preview (button/badge/header + contrast) that
 * MIRRORS the server, the corrected-value warning when < 4.5:1, save wiring,
 * logo placeholder + upload error keeping the old logo, and the 5 states.
 * @module components/admin/theming-console.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemingConsole } from "./theming-console";
import { previewBrand } from "@/lib/adm-theme";
import type { LoadedTheme } from "@/lib/use-adm-theme";
import type { Role } from "@/lib/roles";

const THEME: LoadedTheme = {
  brand: "#003f7f",
  welcomeMessages: { fr: "Bienvenue", en: "Welcome" },
  logoUrl: null,
};

function ok() {
  return vi.fn(async () => ({ ok: true as const }));
}

function renderReady(overrides: Partial<React.ComponentProps<typeof ThemingConsole>> = {}) {
  return render(
    <ThemingConsole
      role="BANK_ADMIN"
      status="ready"
      theme={THEME}
      onSave={ok()}
      onUploadLogo={ok()}
      {...overrides}
    />,
  );
}

describe("ThemingConsole — RBAC (theming = BANK_ADMIN+)", () => {
  it("ADM-001b: BANK_ADMIN et AGENCY_DIRECTOR atteignent la console", () => {
    (["BANK_ADMIN", "AGENCY_DIRECTOR"] as Role[]).forEach((role) => {
      renderReady({ role });
      expect(screen.getByTestId("theming-console")).toBeInTheDocument();
      cleanup();
    });
  });

  it("ADM-001b: AGENT / MANAGER / AUDITOR → 403 (section interdite, jamais de console)", () => {
    (["AGENT", "MANAGER", "AUDITOR"] as Role[]).forEach((role) => {
      renderReady({ role });
      expect(screen.getByTestId("theming-forbidden")).toBeInTheDocument();
      expect(screen.queryByTestId("theming-console")).not.toBeInTheDocument();
      cleanup();
    });
  });
});

describe("ThemingConsole — habillage jamais structure", () => {
  it("ADM-001b: la mention « habillage, jamais la structure » est visible", () => {
    renderReady();
    expect(screen.getByTestId("theming-habillage-notice")).toHaveTextContent(/habillage/i);
  });

  it("ADM-001b: AUCUN contrôle de layout/structure n'est exposé (test d'absence)", () => {
    renderReady();
    const forbidden = [/police|font/i, /espacement|spacing/i, /marge|margin/i, /rayon|radius/i, /grille|grid|layout/i, /mise en page/i];
    forbidden.forEach((re) => {
      expect(screen.queryByLabelText(re)).not.toBeInTheDocument();
    });
    // Only the brand colour, welcome messages and logo inputs exist.
    expect(screen.getByTestId("adm-brand-hex")).toBeInTheDocument();
    expect(screen.getByTestId("adm-brand-picker")).toBeInTheDocument();
    expect(screen.getByTestId("adm-welcome-fr")).toBeInTheDocument();
    expect(screen.getByTestId("adm-logo-input")).toBeInTheDocument();
  });
});

describe("ThemingConsole — preview temps réel + contraste (miroir serveur)", () => {
  it("ADM-001b: preview rend bouton / badge / en-tête", () => {
    renderReady();
    expect(screen.getByTestId("preview-button")).toBeInTheDocument();
    expect(screen.getByTestId("preview-badge")).toBeInTheDocument();
    expect(screen.getByTestId("preview-header")).toBeInTheDocument();
  });

  it("ADM-001b: le ratio affiché = miroir exact de previewBrand (utilitaire partagé)", async () => {
    const user = userEvent.setup();
    renderReady();
    const hex = screen.getByTestId("adm-brand-hex");
    await user.clear(hex);
    await user.type(hex, "#003f7f");
    const expected = previewBrand("#003f7f").ratio.toFixed(2);
    expect(screen.getByTestId("preview-contrast-ratio")).toHaveTextContent(`${expected}:1`);
  });

  it("ADM-001b: brand passant AA → badge conforme, pas d'avertissement", async () => {
    const user = userEvent.setup();
    renderReady();
    const hex = screen.getByTestId("adm-brand-hex");
    await user.clear(hex);
    await user.type(hex, "#003f7f");
    expect(screen.getByTestId("preview-contrast-pass")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-contrast-warning")).not.toBeInTheDocument();
  });

  it("ADM-001b: brand hors 4.5:1 → avertissement + valeur corrigée (identique au calcul serveur)", async () => {
    const user = userEvent.setup();
    renderReady();
    const hex = screen.getByTestId("adm-brand-hex");
    await user.clear(hex);
    await user.type(hex, "#ffe000");
    const p = previewBrand("#ffe000");
    expect(p.passes).toBe(false);
    expect(screen.getByTestId("preview-contrast-warning")).toBeInTheDocument();
    expect(screen.getByTestId("preview-applied-brand")).toHaveTextContent(p.appliedBrand);
  });
});

describe("ThemingConsole — édition couleur (picker) et messages", () => {
  it("ADM-001b: le color picker met à jour la couleur (hex + preview)", () => {
    renderReady();
    const picker = screen.getByTestId("adm-brand-picker") as HTMLInputElement;
    fireEvent.change(picker, { target: { value: "#123456" } });
    expect(screen.getByTestId("adm-brand-hex")).toHaveValue("#123456");
    // La preview reflète la couleur choisie (ratio sur surface).
    const expected = previewBrand("#123456").ratio.toFixed(2);
    expect(screen.getByTestId("preview-contrast-ratio")).toHaveTextContent(`${expected}:1`);
  });

  it("ADM-001b: éditer le message EN → transmis au save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: true as const }));
    renderReady({ onSave });
    await user.type(screen.getByTestId("adm-welcome-en"), "!");
    await user.click(screen.getByTestId("adm-theme-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ welcomeMessages: expect.objectContaining({ en: "Welcome!" }) }),
    );
  });
});

describe("ThemingConsole — save (PATCH) sans rechargement", () => {
  it("ADM-001b: save renvoyant une couleur corrigée → la valeur persistée est reflétée", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: true as const, theme: { ...THEME, brand: "#001f3f" } }));
    renderReady({ onSave });
    await user.click(screen.getByTestId("adm-theme-save"));
    await waitFor(() => expect(screen.getByTestId("adm-theme-saved")).toBeInTheDocument());
    // La couleur reflète la valeur persistée renvoyée par le serveur.
    expect(screen.getByTestId("adm-brand-hex")).toHaveValue("#001f3f");
  });

  it("ADM-001b: enregistrer → onSave appelé avec brand + welcomeMessages, confirmation inline", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: true as const, theme: { ...THEME, brand: "#002f5f" } }));
    renderReady({ onSave });
    await user.click(screen.getByTestId("adm-theme-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "#003f7f",
        welcomeMessages: expect.objectContaining({ fr: "Bienvenue" }),
      }),
    );
    await waitFor(() => expect(screen.getByTestId("adm-theme-saved")).toBeInTheDocument());
  });

  it("ADM-001b: erreur serveur au save → message humain inline, jamais de modale", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => ({ ok: false as const, message: "Couleur invalide." }));
    renderReady({ onSave });
    await user.click(screen.getByTestId("adm-theme-save"));
    await waitFor(() => expect(screen.getByTestId("adm-theme-server-error")).toHaveTextContent("Couleur invalide."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("ThemingConsole — logo", () => {
  it("ADM-001b: logo absent → placeholder nom banque (jamais de layout cassé)", () => {
    renderReady();
    expect(screen.getByTestId("adm-logo-placeholder")).toBeInTheDocument();
  });

  it("ADM-001b: upload échoué → message inline, ancien logo conservé", async () => {
    const user = userEvent.setup();
    const onUploadLogo = vi.fn(async () => ({ ok: false as const, message: "Logo non appliqué." }));
    renderReady({ theme: { ...THEME, logoUrl: "https://cdn/old.png" }, onUploadLogo });
    const input = screen.getByTestId("adm-logo-input");
    // Accepted MIME so the change fires; the SERVER rejects it (INVALID_LOGO).
    await user.upload(input, new File(["x"], "too-small.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByTestId("adm-logo-error")).toHaveTextContent("Logo non appliqué."));
    // L'ancien logo reste affiché.
    expect(screen.getByTestId("adm-logo-preview")).toHaveAttribute("src", "https://cdn/old.png");
  });
});

describe("ThemingConsole — 5 états", () => {
  it("ADM-001b: loading → skeleton", () => {
    renderReady({ status: "loading", theme: null });
    expect(screen.getByTestId("theming-loading")).toBeInTheDocument();
  });

  it("ADM-001b: empty → message vide", () => {
    renderReady({ status: "empty", theme: null });
    expect(screen.getByTestId("theming-empty")).toBeInTheDocument();
  });

  it("ADM-001b: error → message + retry", () => {
    const onRetry = vi.fn();
    renderReady({ status: "error", theme: null, onRetry });
    expect(screen.getByTestId("theming-error")).toBeInTheDocument();
    expect(screen.getByTestId("theming-retry")).toBeInTheDocument();
  });

  it("ADM-001b: offline → « Connexion requise pour configurer »", () => {
    renderReady({ status: "offline", theme: null });
    expect(screen.getByTestId("theming-offline")).toHaveTextContent(/connexion requise/i);
  });

  it("ADM-001b: FR/EN — la console rend en anglais quand locale=en", () => {
    renderReady({ locale: "en" });
    expect(screen.getByTestId("theming-habillage-notice")).toHaveTextContent(/skin|structure/i);
  });
});
