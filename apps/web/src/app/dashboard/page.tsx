/**
 * Generic dashboard page — role-specific routing handled by middleware.
 * @module app/dashboard/page
 */
import type { ReactElement } from "react";

export default function DashboardPage(): ReactElement {
  return (
    <main role="main" style={{ padding: "2rem", backgroundColor: "var(--surface-0)" }}>
      <h1 style={{ color: "var(--ink-strong)" }}>Tableau de bord</h1>
    </main>
  );
}
