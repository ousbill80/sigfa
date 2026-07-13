import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Heading,
  PageTitle,
  SectionTitle,
  Overline,
} from "./Typography.js";

describe("Typography", () => {
  describe("Heading", () => {
    it("renders an h1 with the default 2xl size", () => {
      render(<Heading>Tableau de bord</Heading>);
      const el = screen.getByRole("heading", { level: 1 });
      expect(el).toHaveTextContent("Tableau de bord");
      expect(el).toHaveClass("sig-heading", "sig-heading--2xl");
      expect(el).toHaveAttribute("data-testid", "heading");
    });

    it.each(["xl", "2xl", "3xl"] as const)(
      "supports the %s size variant",
      (size) => {
        render(<Heading size={size}>x</Heading>);
        expect(screen.getByText("x")).toHaveClass(`sig-heading--${size}`);
      },
    );

    it("merges a caller className", () => {
      render(<Heading className="mt-4">x</Heading>);
      expect(screen.getByText("x")).toHaveClass("sig-heading", "mt-4");
    });
  });

  describe("PageTitle", () => {
    it("is a Heading alias tagged with its own testid", () => {
      render(<PageTitle>Accueil</PageTitle>);
      const el = screen.getByRole("heading", { level: 1 });
      expect(el).toHaveClass("sig-heading");
      expect(el).toHaveAttribute("data-testid", "page-title");
    });
  });

  describe("SectionTitle", () => {
    it("renders an h2 with the default lg size", () => {
      render(<SectionTitle>Détails</SectionTitle>);
      const el = screen.getByRole("heading", { level: 2 });
      expect(el).toHaveClass("sig-section-title", "sig-section-title--lg");
      expect(el).toHaveAttribute("data-testid", "section-title");
    });

    it.each(["lg", "xl"] as const)("supports the %s size", (size) => {
      render(<SectionTitle size={size}>x</SectionTitle>);
      expect(screen.getByText("x")).toHaveClass(
        `sig-section-title--${size}`,
      );
    });
  });

  describe("Overline", () => {
    it("renders a kicker with its class + testid", () => {
      render(<Overline>Section</Overline>);
      const el = screen.getByText("Section");
      expect(el).toHaveClass("sig-overline");
      expect(el).toHaveAttribute("data-testid", "overline");
    });
  });
});
