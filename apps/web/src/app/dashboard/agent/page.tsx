/**
 * Agent dashboard page — refonte visuelle v2 « Sérénité Premium ».
 * Tokens v2 uniquement (les tokens v1 --surface-0 / --ink-strong ont disparu).
 * @module app/dashboard/agent/page
 */
import type { ReactElement } from "react";

export default function AgentDashboardPage(): ReactElement {
  return (
    <main
      role="main"
      style={{
        minHeight: "100%",
        padding: "var(--space-8)",
        background: "var(--paper)",
        color: "var(--ink)",
        fontFamily: "var(--font-text)",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-text)",
          fontSize: "var(--text-xs)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-tight)",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          margin: 0,
        }}
      >
        SIGFA
      </p>
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
        Guichet Agent
      </h1>
    </main>
  );
}
