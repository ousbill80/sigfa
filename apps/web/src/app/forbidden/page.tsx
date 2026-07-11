/**
 * 403 Forbidden page — shown when RBAC denies access.
 * @module app/forbidden/page
 */
import type { ReactElement } from "react";
import Link from "next/link";

interface ForbiddenPageProps {
  searchParams: Promise<{ dashboard?: string }>;
}

/** 403 page with link back to user's authorized dashboard */
export default async function ForbiddenPage({ searchParams }: ForbiddenPageProps): Promise<ReactElement> {
  const params = await searchParams;
  const dashboardUrl = params.dashboard ?? "/dashboard";

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
      <h1 style={{ fontSize: "4rem", fontWeight: "bold", color: "var(--danger)" }}>403</h1>
      <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Accès refusé</h2>
      <p style={{ color: "var(--ink-soft)", marginBottom: "2rem" }}>
        Vous n&apos;avez pas les droits pour accéder à cette page.
      </p>
      <Link
        href={dashboardUrl}
        style={{
          backgroundColor: "var(--brand)",
          color: "var(--brand-contrast)",
          padding: "0.75rem 1.5rem",
          borderRadius: "0.5rem",
          textDecoration: "none",
        }}
      >
        Retour au tableau de bord
      </Link>
    </main>
  );
}
