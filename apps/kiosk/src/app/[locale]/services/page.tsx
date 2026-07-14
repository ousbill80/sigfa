/**
 * KIOSK-003 — app/[locale]/services/page.tsx
 * Page de sélection de service. Wrapper client (useSearchParams — démo
 * affluence AUDIT-F24) chargé sans SSR pour l'export statique, même motif
 * que les pages conseillers et feedback. Le catalogue de démo (AUDIT-F7,
 * calqué borne BNI) vit dans `ServicesPageClient.tsx`.
 */
"use client";

import dynamic from "next/dynamic";

const ServicesPageClient = dynamic(
  () => import("./ServicesPageClient").then((m) => m.ServicesPageClient),
  { ssr: false }
);

export default function ServicesPage() {
  return <ServicesPageClient />;
}
