/**
 * KIOSK-001 — KioskShell.tsx
 * Shell principal du kiosque. Affiche l'écran d'accueil avec choix de langue.
 * Respecte prefers-reduced-motion (pas d'animations inline).
 * Tokens CSS uniquement (pas de valeurs hex en dur).
 */
"use client";

import { useTranslations } from "next-intl";

export function KioskShell() {
  const t = useTranslations("common");

  return (
    <main
      role="main"
      style={{
        backgroundColor: "var(--surface-kiosk)",
        color: "var(--ink-inverse)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-3xl)",
          fontWeight: 700,
          letterSpacing: "var(--tracking-tight)",
          marginBottom: "var(--space-4)",
        }}
      >
        {t("welcome")}
      </h1>
      <p
        style={{
          fontSize: "var(--text-xl)",
          color: "var(--ink-muted-inv)",
          marginBottom: "var(--space-8)",
        }}
      >
        {t("chooseLanguage")}
      </p>
    </main>
  );
}
