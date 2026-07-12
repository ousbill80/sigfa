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
        gap: "var(--space-3)",
        padding: "var(--space-8)",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-4xl)",
          fontWeight: 700,
          letterSpacing: "var(--tracking-numeric)",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        403
      </h1>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-xl)",
          fontWeight: 600,
          color: "var(--ink)",
          margin: 0,
        }}
      >
        Accès refusé
      </h2>
      <p
        style={{
          color: "var(--ink-soft)",
          marginBottom: "var(--space-6)",
          lineHeight: "var(--leading-body)",
          textAlign: "center",
        }}
      >
        Vous n&apos;avez pas les droits pour accéder à cette page.
      </p>
      <Link
        href={dashboardUrl}
        className="sig-btn sig-btn--primary sig-btn--md"
        style={{ textDecoration: "none" }}
      >
        Retour au tableau de bord
      </Link>
    </main>
  );
}
