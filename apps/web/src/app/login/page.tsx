/**
 * Login page — renders the auth form.
 * @module app/login/page
 */
import type { ReactElement } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { Suspense } from "react";

/** Login page */
export default function LoginPage(): ReactElement {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        background:
          "radial-gradient(120% 80% at 50% -10%, var(--surface-2) 0%, var(--paper) 60%)",
      }}
    >
      <Suspense fallback={<div style={{ color: "var(--ink-soft)" }}>Chargement…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
