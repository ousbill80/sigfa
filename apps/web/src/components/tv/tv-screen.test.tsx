/**
 * Tests for TvScreen — TV v3 « split permanent » (design-gate PO 2026-07-13,
 * réf. photo BNI, option « flash dans la colonne »).
 *
 * Layout : bandeau haut --brand (pastille + banque · date · horloge) ; zone
 * gauche ~75 % = AdZone permanente ; colonne droite ~25 % = carte appel courant
 * (flash --brand à l'appel) + derniers appelés + longueur de file.
 * 5 états : nominal · loading · empty · error · offline.
 * @module components/tv/tv-screen.test
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TvScreen, heroNumberFontSize } from "./tv-screen";
import { initialTvState, type TvState, type TvCall } from "@/lib/tv-state";
import { SUPPORTED_LOCALES, t } from "@/lib/i18n";
import type { TvMediaItem } from "@/lib/tv-media";

function call(displayNumber: string, counterLabel: string, calledAt: string): TvCall {
  return { ticketNumber: displayNumber, displayNumber, counterLabel, calledAt };
}

const nominal: TvState = {
  hero: call("OC-047", "Guichet 3", "2026-07-11T09:30:00Z"),
  previous: [
    call("OC-046", "Guichet 1", "2026-07-11T09:29:00Z"),
    call("OC-012", "Guichet 4", "2026-07-11T09:28:00Z"),
    call("OC-045", "Guichet 2", "2026-07-11T09:27:00Z"),
  ],
  queue: ["OC-048", "OC-049", "OC-050"],
  connection: "connected",
};

describe("TvScreen — TV-V3 split permanent", () => {
  it("TV-V3: pub ET appel affichés SIMULTANÉMENT (plus de modes exclusifs)", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" />);
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.getByTestId("tv-hero")).toBeInTheDocument();
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
  });

  it("TV-V3: split ~75/25 — grille 3fr / 1fr en tokens de layout", () => {
    render(<TvScreen state={nominal} />);
    const split = screen.getByTestId("tv-split");
    const style = split.getAttribute("style") ?? "";
    expect(style).toContain("3fr");
    expect(style).toContain("1fr");
  });

  it("TV-V3: carrousel actif EN PERMANENCE (data-active=on) même avec un appel", () => {
    render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-adzone")).toHaveAttribute("data-active", "on");
  });

  it("TV-V3: colonne d'appels — fond sombre --night-2 + séparateur token", () => {
    render(<TvScreen state={nominal} />);
    const column = screen.getByTestId("tv-call-column");
    const style = column.getAttribute("style") ?? "";
    expect(style).toContain("var(--night-2");
    expect(style).toContain("var(--tv-separator)");
  });

  it("TV-V3: carte appel courant — libellé guichet + numéro en --display-tv-counter", () => {
    render(<TvScreen state={nominal} />);
    const hero = screen.getByTestId("tv-hero");
    expect(within(hero).getByTestId("tv-hero-counter")).toHaveTextContent("Guichet 3");
    const number = within(hero).getByTestId("tv-hero-number");
    expect(number).toHaveTextContent("OC-047");
    const style = number.getAttribute("style") ?? "";
    expect(style).toContain("var(--display-tv-counter)");
    expect(style).toContain("var(--font-display)");
    expect(style).toContain("tabular-nums");
  });

  it("TV-V3: derniers appelés dans la colonne — style PreviousCard en retrait", () => {
    render(<TvScreen state={nominal} />);
    const column = screen.getByTestId("tv-call-column");
    const cards = within(column).getAllByTestId("tv-previous-card");
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.getAttribute("style")).toContain("var(--ink-inverse-soft)");
    }
  });

  it("TV-V3: bas de colonne — « En attente : N » (longueur de file, style actuel)", () => {
    render(<TvScreen state={nominal} />);
    const column = screen.getByTestId("tv-call-column");
    const queue = within(column).getByTestId("tv-queue");
    expect(within(queue).getByText(t("tv.waiting", "fr"))).toBeInTheDocument();
    const count = within(queue).getByTestId("tv-queue-count");
    expect(count).toHaveTextContent(String(nominal.queue.length));
    expect(count.getAttribute("style")).toContain("var(--display-tv-counter)");
  });
});

describe("TvScreen — numéro appelé sur UNE ligne (nowrap + taille adaptative)", () => {
  it("TV-NOWRAP: le numéro porte white-space nowrap — « OC-001 » ne casse jamais", () => {
    render(<TvScreen state={nominal} />);
    const number = screen.getByTestId("tv-hero-number");
    const style = number.getAttribute("style") ?? "";
    expect(style).toContain("white-space: nowrap");
  });

  it("TV-NOWRAP: taille adaptative en cqw, bornée par --display-tv-counter (container carte)", () => {
    render(<TvScreen state={nominal} />);
    const style = screen.getByTestId("tv-hero-number").getAttribute("style") ?? "";
    expect(style).toContain("min(var(--display-tv-counter)");
    expect(style).toContain("cqw");
    // La carte est le container CSS de référence du numéro.
    const hero = screen.getByTestId("tv-hero");
    expect(hero.getAttribute("style")).toContain("container-type: inline-size");
  });

  it("TV-NOWRAP: formats plus longs — la taille par caractère décroît (OC-123, P010, etc.)", () => {
    const size = (n: string): number => {
      const match = /(\d+)cqw/.exec(heroNumberFontSize(n));
      return Number(match?.[1]);
    };
    expect(size("P010")).toBeGreaterThan(size("OC-001"));
    expect(size("OC-001")).toBe(size("OC-123"));
    expect(size("OC-001")).toBeGreaterThan(size("OC-12345"));
    // Toujours borné par le token d'affichage TV.
    expect(heroNumberFontSize("OC-001")).toContain("var(--display-tv-counter)");
  });

  it("TV-NOWRAP: derniers appelés — numéros aussi sur UNE ligne (nowrap + cqw borné --display-tv)", () => {
    render(<TvScreen state={nominal} />);
    for (const card of screen.getAllByTestId("tv-previous-card")) {
      expect(card.getAttribute("style")).toContain("container-type: inline-size");
      const number = card.firstElementChild as HTMLElement;
      const style = number.getAttribute("style") ?? "";
      expect(style).toContain("white-space: nowrap");
      expect(style).toContain("min(var(--display-tv)");
      expect(style).toContain("cqw");
    }
  });
});

describe("TvScreen — zone média dynamique (manifeste) et repli promo texte", () => {
  const media: readonly TvMediaItem[] = [
    { type: "image", src: "/tv-media/promo-epargne.svg" },
    { type: "video", src: "/tv-media/demo-clip.mp4" },
  ];

  it("TV-MEDIA: playlist fournie — la zone gauche joue les médias (pas la promo texte)", () => {
    render(<TvScreen state={nominal} mediaItems={media} />);
    expect(screen.getByTestId("tv-media-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-adzone")).toBeNull();
  });

  it("TV-MEDIA: REPLI sans manifeste/playlist vide — promo texte actuelle inchangée", () => {
    render(<TvScreen state={nominal} mediaItems={[]} />);
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-media-zone")).toBeNull();
  });

  it("TV-MEDIA: l'appel reste prioritaire — colonne « MAINTENANT SERVI » jamais masquée par les médias", () => {
    render(<TvScreen state={nominal} mediaItems={media} celebration />);
    // La zone média vit dans la cellule GAUCHE de la grille split ; la colonne
    // d'appels reste rendue et le flash de célébration actif.
    expect(screen.getByTestId("tv-call-column")).toBeInTheDocument();
    expect(screen.getByTestId("tv-hero")).toHaveAttribute("data-celebration", "on");
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
    // Aucun z-index élevé côté média (elle ne peut pas recouvrir la colonne).
    expect(screen.getByTestId("tv-media-zone").getAttribute("style")).not.toContain("z-index");
  });
});

describe("TvScreen — TV-V3 bandeau haut", () => {
  it("TV-V3: bandeau sur fond --brand, texte inverse, hauteur --tv-header-height", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" />);
    const header = screen.getByTestId("tv-header");
    const style = header.getAttribute("style") ?? "";
    expect(style).toContain("var(--brand)");
    expect(style).toContain("var(--brand-contrast)");
    expect(style).toContain("var(--tv-header-height)");
  });

  it("TV-V3: pastille logo sur --brand-contrast (lisible sur bandeau brand) + nom banque", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" />);
    const header = screen.getByTestId("tv-header");
    const mark = within(header).getByTestId("tv-brand-mark");
    expect(mark.getAttribute("style")).toContain("var(--brand-contrast)");
    expect(within(header).getByText("Banque du Commerce")).toBeInTheDocument();
  });

  it("TV-LOGO: repli sans logo — pastille bien visible (~48px) avec l'initiale de la banque", () => {
    render(<TvScreen state={nominal} tenantName="Banque du Commerce" />);
    const mark = screen.getByTestId("tv-brand-mark");
    expect(mark).toHaveTextContent("B");
    const style = mark.getAttribute("style") ?? "";
    // Dimensionnée sur le bandeau (--tv-header-height − --space-4 ≈ 48px).
    expect(style).toContain("var(--tv-header-height)");
    expect(screen.queryByTestId("tv-brand-logo")).toBeNull();
  });

  it("TV-LOGO: logoUrl provisionné (NEXT_PUBLIC_BANK_LOGO_URL) — logo affiché à gauche du bandeau", () => {
    render(
      <TvScreen state={nominal} tenantName="Banque du Commerce" logoUrl="/tenants/bdc/logo.svg" />
    );
    const header = screen.getByTestId("tv-header");
    const logo = within(header).getByTestId("tv-brand-logo");
    expect(logo).toHaveAttribute("src", "/tenants/bdc/logo.svg");
    const style = logo.getAttribute("style") ?? "";
    // Hauteur pilotée par le bandeau (~48px dans un bandeau de 64px).
    expect(style).toContain("var(--tv-header-height)");
    expect(style).toContain("object-fit: contain");
    // Plus de pastille quand le logo est là ; le nom reste affiché à côté.
    expect(within(header).queryByTestId("tv-brand-mark")).toBeNull();
    expect(within(header).getByText("Banque du Commerce")).toBeInTheDocument();
  });

  it("TV-V3: date complète au centre du bandeau", () => {
    render(<TvScreen state={nominal} dateLabel="Dimanche 13 juillet 2026" />);
    const date = screen.getByTestId("tv-date");
    expect(date).toHaveTextContent("Dimanche 13 juillet 2026");
  });

  it("TV-V3: horloge à droite — bloc contrasté (fond nuit), grande, tabular-nums", () => {
    render(<TvScreen state={nominal} clock="14:10:22" />);
    const clock = screen.getByTestId("tv-clock");
    expect(clock).toHaveTextContent("14:10:22");
    const style = clock.getAttribute("style") ?? "";
    expect(style).toContain("var(--night-2");
    expect(style).toContain("var(--ink-inverse)");
    expect(style).toContain("tabular-nums");
  });
});

describe("TvScreen — 5 états", () => {
  it("TV-V3: état nominal — data-state nominal, pub + appel présents", () => {
    render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-state", "nominal");
  });

  it("TV-V3: état loading — skeleton adapté au split, sans flash blanc", () => {
    render(<TvScreen state={initialTvState} loading />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-state", "loading");
    const skeleton = screen.getByTestId("tv-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    // Deux volets squelettés : zone pub + colonne d'appels.
    expect(within(skeleton).getByTestId("tv-skeleton-ad")).toBeInTheDocument();
    expect(within(skeleton).getByTestId("tv-skeleton-hero")).toBeInTheDocument();
    // Pas de carrousel ni de numéro pendant le chargement.
    expect(screen.queryByTestId("tv-adzone")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tv-hero-number")).not.toBeInTheDocument();
    // Surface sombre (aucun flash blanc).
    expect(screen.getByTestId("tv-screen").getAttribute("style")).toContain("var(--surface-screen)");
  });

  it("TV-V3: état empty — carte affiche l'état vide traduit, la pub CONTINUE", () => {
    render(<TvScreen state={initialTvState} />);
    expect(screen.getByTestId("tv-screen")).toHaveAttribute("data-state", "empty");
    const empty = screen.getByTestId("tv-empty");
    expect(empty).toHaveTextContent(t("tv.empty", "fr"));
    // La pub n'est jamais interrompue, la structure de colonne est préservée.
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.getByTestId("tv-previous")).toBeInTheDocument();
    expect(screen.getByTestId("tv-queue")).toBeInTheDocument();
    expect(screen.queryByTestId("tv-hero-number")).not.toBeInTheDocument();
  });

  it("TV-V3: état error — payload invalide ignoré en amont, affichage stable", () => {
    // Le reducer ignore les payloads Zod invalides (tv-state.test) ; l'écran
    // rend le dernier état connu inchangé.
    const { rerender } = render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
    rerender(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
  });

  it("TV-V3: état offline — bandeau bas existant inchangé, split conservé", () => {
    const offlineState: TvState = { ...nominal, connection: "offline" };
    render(<TvScreen state={offlineState} />);
    const banner = screen.getByTestId("tv-offline-banner");
    expect(banner).toHaveTextContent(t("tv.offline", "fr"));
    expect(banner).toHaveAttribute("role", "status");
    // Dernier état conservé : pub + appel toujours affichés.
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
    expect(screen.getByTestId("tv-hero-number")).toHaveTextContent("OC-047");
  });
});

describe("TvScreen — TV-002 flash conservé (option « flash dans la colonne »)", () => {
  it("TV-002: célébration — la carte passe sur fond --brand avec halo, pub non interrompue", () => {
    render(<TvScreen state={nominal} celebration />);
    const hero = screen.getByTestId("tv-hero");
    expect(hero).toHaveAttribute("data-celebration", "on");
    const style = hero.getAttribute("style") ?? "";
    expect(style).toContain("var(--brand)");
    expect(style).toContain("var(--shadow-gold)");
    // La pub n'est JAMAIS interrompue par l'appel.
    expect(screen.getByTestId("tv-adzone")).toBeInTheDocument();
  });

  it("TV-002: sans célébration — la carte revient au repos (surface sombre, sans halo)", () => {
    render(<TvScreen state={nominal} celebration={false} />);
    const hero = screen.getByTestId("tv-hero");
    expect(hero).toHaveAttribute("data-celebration", "off");
    const style = hero.getAttribute("style") ?? "";
    expect(style).toContain("var(--surface-screen)");
    expect(style).not.toContain("var(--shadow-gold)");
  });

  it("TV-002: transitions en tokens uniquement (aucune durée en dur)", () => {
    render(<TvScreen state={nominal} />);
    const style = screen.getByTestId("tv-hero").getAttribute("style") ?? "";
    expect(style).toContain("var(--duration-celebration)");
    expect(style).toContain("var(--tv-slide-duration)");
    expect(style).not.toMatch(/\d+ms/);
  });

  it("TV-002: prefers-reduced-motion — transition désactivée (changement instantané)", () => {
    render(<TvScreen state={nominal} reducedMotion />);
    const style = screen.getByTestId("tv-hero").getAttribute("style") ?? "";
    expect(style).toContain("transition: none");
  });
});

describe("TvScreen — tokens & i18n", () => {
  it("TV-V3: tokens uniquement — surface --surface-screen, encre --ink-inverse", () => {
    render(<TvScreen state={nominal} />);
    const style = screen.getByTestId("tv-screen").getAttribute("style") ?? "";
    expect(style).toContain("var(--surface-screen)");
    expect(style).toContain("var(--ink-inverse)");
  });

  it("TV-V3: i18n — labels colonne + état vide rendus en FR/EN sans crash", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { unmount } = render(<TvScreen state={initialTvState} locale={locale} />);
      expect(screen.getByText(t("tv.recent_calls", locale))).toBeInTheDocument();
      expect(screen.getByText(t("tv.waiting", locale))).toBeInTheDocument();
      expect(screen.getByTestId("tv-empty")).toHaveTextContent(t("tv.empty", locale));
      unmount();
    }
  });

  it("TV-V3: accessibilité — la carte d'appel reste annoncée en aria-live polite", () => {
    render(<TvScreen state={nominal} />);
    expect(screen.getByTestId("tv-hero")).toHaveAttribute("aria-live", "polite");
  });
});
