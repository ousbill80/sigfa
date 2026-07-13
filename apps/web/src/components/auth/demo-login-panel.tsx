/**
 * DemoLoginPanel — bloc « Mode démo — connexion directe » (PHASE DE TEST).
 *
 * Rendu UNIQUEMENT quand le serveur l'autorise (SIGFA_DEMO_LOGIN=1) : la page
 * de login (server component) ne lui passe que la liste des rôles disponibles
 * — JAMAIS de secret dans le bundle client. Clic sur un rôle →
 * POST /api/auth/demo-login {role} (les identifiants sont résolus côté
 * serveur) puis même redirection que le login normal (`next` ou /dashboard).
 *
 * v2 « Sérénité Premium » : tokens uniquement, composants @sigfa/ui,
 * libellés en français (feature FR-only de phase de test).
 * @module components/auth/demo-login-panel
 */
"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card } from "@sigfa/ui";
import { t } from "@/lib/i18n";
import type { DemoLoginRole } from "@/lib/demo-login";

/** Libellés FR des rôles démo (feature de test, FR uniquement). */
const ROLE_LABELS: Record<DemoLoginRole, string> = {
  BANK_ADMIN: "Administrateur banque",
  AGENCY_DIRECTOR: "Directeur d'agence",
  MANAGER: "Manager",
  AGENT: "Agent",
  AUDITOR: "Auditeur",
};

/** Props du panneau démo. */
export interface DemoLoginPanelProps {
  /** Rôles disponibles, exposés par le serveur (seule donnée transmise). */
  roles: DemoLoginRole[];
}

/** Bloc « Mode démo — connexion directe » affiché sous le formulaire de login. */
export function DemoLoginPanel({ roles }: DemoLoginPanelProps): ReactElement {
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") ?? "/dashboard";

  const [loadingRole, setLoadingRole] = useState<DemoLoginRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDemoLogin(role: DemoLoginRole): Promise<void> {
    setLoadingRole(role);
    setError(null);

    try {
      const res = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      if (!res.ok) {
        setLoadingRole(null);
        setError(t("auth.error"));
        return;
      }

      // Même redirection que le login normal.
      window.location.href = nextUrl;
    } catch {
      setLoadingRole(null);
      setError(t("error.service_unavailable"));
    }
  }

  return (
    <Card style={{ width: "100%", maxWidth: "26rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          marginBottom: "var(--space-2)",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-md)",
            fontWeight: 600,
            letterSpacing: "var(--tracking-tight)",
            color: "var(--ink)",
            margin: 0,
          }}
        >
          Mode démo — connexion directe
        </h2>
        <span
          style={{
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            textTransform: "uppercase",
            color: "var(--warning)",
            background: "var(--warning-soft)",
            padding: "0 var(--space-2)",
            borderRadius: "var(--r-full)",
            lineHeight: 1.8,
            flexShrink: 0,
          }}
        >
          Test
        </span>
      </div>

      <p
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--ink-soft)",
          margin: `0 0 var(--space-4)`,
        }}
      >
        Connexion immédiate avec un compte de démonstration — environnement de
        test uniquement.
      </p>

      <div
        role="group"
        aria-label="Connexion directe par rôle"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {roles.map((role) => (
          <Button
            key={role}
            type="button"
            variant="secondary"
            size="dense"
            disabled={loadingRole !== null}
            onClick={() => void handleDemoLogin(role)}
            style={{ width: "100%" }}
          >
            {loadingRole === role ? t("loading") : ROLE_LABELS[role]}
          </Button>
        ))}
      </div>

      {error && (
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
            marginTop: "var(--space-4)",
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
          {error}
        </div>
      )}
    </Card>
  );
}
