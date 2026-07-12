/**
 * Generic dashboard page — role-specific routing handled by middleware.
 * @module app/dashboard/page
 */
import type { ReactElement } from "react";

export default function DashboardPage(): ReactElement {
  return (
    <main
      role="main"
      style={{
        minHeight: "100vh",
        padding: "var(--space-12)",
        background: "var(--paper)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-3xl)",
          fontWeight: 600,
          lineHeight: "var(--leading-tight)",
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        Tableau de bord
      </h1>
    </main>
  );
}
