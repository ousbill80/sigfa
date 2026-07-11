/**
 * KIOSK-001 — app/[locale]/page.tsx
 * Page d'accueil kiosque : sélection de la langue.
 */
// Imports sans extension .js — convention Next.js 15 (bundler webpack/turbopack ne résout pas .js→.ts)
import { KioskShell } from "@/components/KioskShell";

export default function HomePage() {
  return <KioskShell />;
}
