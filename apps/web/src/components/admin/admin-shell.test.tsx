/**
 * Tests for AdminShell (DESIGN-FIX-ADMIN) — the shared admin coquille wrapping
 * the three consoles: product header (SIGFA wordmark + title), nav to
 * theming / onboarding / kiosks, active route marked `aria-current="page"`,
 * FR/EN labels, and the children rendered in the content column.
 * @module components/admin/admin-shell.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminShell } from "./admin-shell";

let mockPathname = "/admin/theming";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  mockPathname = "/admin/theming";
});

describe("DESIGN-FIX-ADMIN: AdminShell — coquille partagée", () => {
  it("rend le header produit (wordmark SIGFA + titre) et les 3 liens de nav", () => {
    render(
      <AdminShell>
        <p>console</p>
      </AdminShell>,
    );
    expect(screen.getByTestId("admin-shell")).toBeInTheDocument();
    expect(screen.getByText("SIGFA")).toBeInTheDocument();
    expect(screen.getByTestId("admin-nav-theming")).toHaveAttribute("href", "/admin/theming");
    expect(screen.getByTestId("admin-nav-onboarding")).toHaveAttribute("href", "/admin/onboarding");
    expect(screen.getByTestId("admin-nav-kiosks")).toHaveAttribute("href", "/admin/kiosks");
  });

  it("marque la route active avec aria-current=page", () => {
    mockPathname = "/admin/kiosks";
    render(
      <AdminShell>
        <p>console</p>
      </AdminShell>,
    );
    expect(screen.getByTestId("admin-nav-kiosks")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-nav-theming")).not.toHaveAttribute("aria-current");
  });

  it("rend les enfants (la console) dans la colonne de contenu", () => {
    render(
      <AdminShell>
        <p data-testid="child">console</p>
      </AdminShell>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("FR/EN — les libellés de nav sont traduits (locale=en)", () => {
    render(
      <AdminShell locale="en">
        <p>console</p>
      </AdminShell>,
    );
    expect(screen.getByTestId("admin-nav-theming")).toHaveTextContent("Identity");
    expect(screen.getByTestId("admin-nav-kiosks")).toHaveTextContent("Kiosks");
  });
});
