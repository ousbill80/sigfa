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
        backgroundColor: "var(--surface-0)",
        color: "var(--ink-strong)",
      }}
    >
      <h1 style={{ fontSize: "2rem", fontWeight: "bold", color: "var(--danger)", marginBottom: "1rem" }}>
        Service indisponible
      </h1>
      <p style={{ color: "var(--ink-soft)", textAlign: "center", maxWidth: "40ch" }}>
        Le service SIGFA est temporairement indisponible. Veuillez réessayer dans quelques instants.
      </p>
    </main>
  );
}
