/**
 * Login page — renders the auth form.
 *
 * Connexion démo directe (PHASE DE TEST) : ce server component lit le gate
 * `SIGFA_DEMO_LOGIN` côté serveur et ne transmet au client QUE la liste des
 * rôles démo disponibles (jamais de secret). Flag OFF (défaut) → la page est
 * strictement inchangée : aucun bloc démo, aucun bouton.
 * @module app/login/page
 */
import type { ReactElement } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { DemoLoginPanel } from "@/components/auth/demo-login-panel";
import { getAvailableDemoRoles } from "@/lib/demo-login";
import { Suspense } from "react";

/** Login page */
export default function LoginPage(): ReactElement {
  const demoRoles = getAvailableDemoRoles();

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-6)",
        padding: "var(--space-6)",
        background:
          "radial-gradient(120% 80% at 50% -10%, var(--surface-2) 0%, var(--paper) 60%)",
      }}
    >
      <Suspense fallback={<div style={{ color: "var(--ink-soft)" }}>Chargement…</div>}>
        <LoginForm />
      </Suspense>
      {demoRoles.length > 0 && (
        <Suspense fallback={null}>
          <DemoLoginPanel roles={demoRoles} />
        </Suspense>
      )}
    </main>
  );
}
