/**
 * Service unavailable page — shown when API healthcheck fails.
 * @module app/error-service/page
 */
import type { ReactElement } from "react";

/** Service indisponible page */
export default function ServiceErrorPage(): ReactElement {
  return (
    <main
      role="main"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        padding: "var(--space-8)",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: "4rem",
          height: "4rem",
          borderRadius: "var(--r-full)",
          background: "var(--danger-soft)",
          color: "var(--danger)",
          fontSize: "var(--text-2xl)",
          fontWeight: 700,
        }}
      >
        !
      </span>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-2xl)",
          fontWeight: 600,
          letterSpacing: "var(--tracking-tight)",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        Service indisponible
      </h1>
      <p
        style={{
          color: "var(--ink-soft)",
          textAlign: "center",
          maxWidth: "40ch",
          lineHeight: "var(--leading-body)",
          margin: 0,
        }}
      >
        Le service SIGFA est temporairement indisponible. Veuillez réessayer dans quelques instants.
      </p>
    </main>
  );
}
