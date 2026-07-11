/**
 * Tests for LoginForm — WEB-001
 * @module components/auth/login-form.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./login-form";
import { server } from "@/test/msw-server";
import { http, HttpResponse } from "msw";
import React from "react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("next=/dashboard"),
}));

describe("LoginForm", () => {
  it("renders login form with French labels", () => {
    render(<LoginForm />);
    expect(screen.getByText("Connexion")).toBeTruthy();
    expect(screen.getByLabelText("Adresse email")).toBeTruthy();
    expect(screen.getByLabelText("Mot de passe")).toBeTruthy();
    expect(screen.getByText("Se connecter")).toBeTruthy();
  });

  it("shows error on invalid credentials", async () => {
    server.use(
      http.post("/api/auth/login", () => {
        return HttpResponse.json({ error: "Invalid" }, { status: 401 });
      })
    );

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Adresse email"), {
      target: { value: "bad@test.com" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "wrong" },
    });
    fireEvent.submit(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("shows service unavailable on network error", async () => {
    server.use(
      http.post("/api/auth/login", () => {
        return HttpResponse.error();
      })
    );

    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Adresse email"), {
      target: { value: "test@test.com" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "pass" },
    });
    fireEvent.submit(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("indisponible");
    });
  });
});
