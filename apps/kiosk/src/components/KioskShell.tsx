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
          fontSize: "2rem",
          fontWeight: "bold",
          marginBottom: "1rem",
        }}
      >
        {t("welcome")}
      </h1>
      <p
        style={{
          fontSize: "1.25rem",
          color: "var(--ink-muted-inv)",
          marginBottom: "2rem",
        }}
      >
        {t("chooseLanguage")}
      </p>
    </main>
  );
}
