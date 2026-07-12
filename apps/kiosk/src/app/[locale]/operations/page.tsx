/**
 * MODEL-KIOSK-A — app/[locale]/operations/page.tsx
 * Écran 2 du parcours borne : sélection de l'OPÉRATION d'un service.
 * Wrapper client (useSearchParams) chargé sans SSR pour l'export statique.
 */
"use client";

import dynamic from "next/dynamic";

const OperationsPageClient = dynamic(
  () => import("./OperationsPageClient").then((m) => m.OperationsPageClient),
  { ssr: false }
);

export default function OperationsPage() {
  return <OperationsPageClient />;
}
