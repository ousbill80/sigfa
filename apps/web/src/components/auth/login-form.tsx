/**
 * Login form component.
 * @module components/auth/login-form
 */
"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { t } from "@/lib/i18n";

/** Login form state */
interface LoginFormState {
  email: string;
  password: string;
  loading: boolean;
  error: string | null;
}

/** Login form component */
export function LoginForm(): ReactElement {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") ?? "/dashboard";

  const [state, setState] = useState<LoginFormState>({
    email: "",
    password: "",
    loading: false,
    error: null,
  });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.email, password: state.password }),
      });

      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: t("auth.error") }));
        return;
      }

      // Redirect to the next URL or dashboard
      window.location.href = nextUrl;
    } catch {
      setState((s) => ({
        ...s,
        loading: false,
        error: t("error.service_unavailable"),
      }));
    }
  }

  return (
    <div
      style={{
        backgroundColor: "var(--surface-0)",
        borderRadius: "0.75rem",
        padding: "2rem",
        width: "100%",
        maxWidth: "400px",
        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
      }}
    >
      <h1
        style={{
          fontSize: "1.5rem",
          fontWeight: "bold",
          color: "var(--ink-strong)",
          marginBottom: "1.5rem",
        }}
      >
        {t("auth.login")}
      </h1>

      <form onSubmit={(e) => void handleSubmit(e)}>
        <div style={{ marginBottom: "1rem" }}>
          <label
            htmlFor="email"
            style={{ display: "block", marginBottom: "0.5rem", color: "var(--ink-strong)" }}
          >
            {t("auth.email")}
          </label>
          <input
            id="email"
            type="email"
            value={state.email}
            onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
            required
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid var(--ink-soft)",
              borderRadius: "0.375rem",
              backgroundColor: "var(--surface-1)",
              color: "var(--ink-strong)",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label
            htmlFor="password"
            style={{ display: "block", marginBottom: "0.5rem", color: "var(--ink-strong)" }}
          >
            {t("auth.password")}
          </label>
          <input
            id="password"
            type="password"
            value={state.password}
            onChange={(e) => setState((s) => ({ ...s, password: e.target.value }))}
            required
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid var(--ink-soft)",
              borderRadius: "0.375rem",
              backgroundColor: "var(--surface-1)",
              color: "var(--ink-strong)",
              boxSizing: "border-box",
            }}
          />
        </div>

        {state.error && (
          <div
            role="alert"
            style={{
              backgroundColor: "#fef2f2",
              color: "var(--danger)",
              padding: "0.75rem",
              borderRadius: "0.375rem",
              marginBottom: "1rem",
            }}
          >
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={state.loading}
          style={{
            width: "100%",
            padding: "0.75rem",
            backgroundColor: "var(--brand)",
            color: "var(--brand-contrast)",
            border: "none",
            borderRadius: "0.375rem",
            fontWeight: "600",
            cursor: state.loading ? "not-allowed" : "pointer",
            opacity: state.loading ? 0.7 : 1,
          }}
        >
          {state.loading ? t("loading") : t("auth.submit")}
        </button>
      </form>
    </div>
  );
}
