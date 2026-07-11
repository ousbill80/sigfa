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
        backgroundColor: "var(--surface-1)",
      }}
    >
      <Suspense fallback={<div>Chargement…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
