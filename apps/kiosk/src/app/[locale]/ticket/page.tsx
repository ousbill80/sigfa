/**
 * KIOSK-005 — app/[locale]/ticket/page.tsx
 * Page du ticket — affiche le numéro, position, attente estimée.
 */
"use client";

import dynamic from "next/dynamic";

// Dynamic import to avoid useSearchParams Suspense requirement in static export
const TicketPageClient = dynamic(
  () => import("./TicketPageClient").then((m) => m.TicketPageClient),
  { ssr: false }
);

export default function TicketPage() {
  return <TicketPageClient />;
}
