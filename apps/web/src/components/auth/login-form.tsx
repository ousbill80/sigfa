/**
 * Login form component — refonte visuelle v2 « Sérénité Premium ».
 * Consomme @sigfa/ui (Card / Field / Button). Comportement inchangé :
 * POST /api/auth/login, redirection `next`, erreurs FR/EN via i18n.
 * @module components/auth/login-form
 */
"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Field } from "@sigfa/ui";
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
    <Card style={{ width: "100%", maxWidth: "26rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          marginBottom: "var(--space-6)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            placeItems: "center",
            width: "3rem",
            height: "3rem",
            borderRadius: "var(--r-md)",
            background: "var(--brand)",
            color: "var(--brand-contrast)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "var(--text-xl)",
            boxShadow: "var(--shadow-brand)",
          }}
        >
          S
        </span>
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-2xl)",
              fontWeight: 600,
              lineHeight: "var(--leading-tight)",
              letterSpacing: "var(--tracking-tight)",
              color: "var(--ink)",
              margin: 0,
            }}
          >
            {t("auth.login")}
          </h1>
          <p
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--ink-soft)",
              margin: 0,
            }}
          >
            SIGFA
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <Field
          id="email"
          label={t("auth.email")}
          type="email"
          value={state.email}
          onChange={(e) => setState((s) => ({ ...s, email: e.target.value }))}
          aria-required="true"
          placeholder="awa@banque.ci"
        />

        <Field
          id="password"
          label={t("auth.password")}
          type="password"
          value={state.password}
          onChange={(e) => setState((s) => ({ ...s, password: e.target.value }))}
          aria-required="true"
        />

        {state.error && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              background: "var(--danger-soft)",
              color: "var(--danger)",
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--r-md)",
              fontSize: "var(--text-sm)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: "0.5rem",
                height: "0.5rem",
                borderRadius: "var(--r-full)",
                background: "var(--danger)",
                flexShrink: 0,
              }}
            />
            {state.error}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={state.loading}
          style={{ width: "100%" }}
        >
          {state.loading ? t("loading") : t("auth.submit")}
        </Button>
      </form>
    </Card>
  );
}
