/**
 * MODEL-KIOSK-B — app/[locale]/managers/page.tsx
 * Écran « Voir mon conseiller » : liste nominative des conseillers de l'agence.
 * Wrapper client (session borne) chargé sans SSR pour l'export statique.
 */
"use client";

import dynamic from "next/dynamic";

const ManagersPageClient = dynamic(
  () => import("./ManagersPageClient").then((m) => m.ManagersPageClient),
  { ssr: false }
);

export default function ManagersPage() {
  return <ManagersPageClient />;
}
