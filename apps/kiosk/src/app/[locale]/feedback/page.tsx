/**
 * KIOSK-009 — app/[locale]/feedback/page.tsx
 * Écran feedback post-service. Wrapper client pour useSearchParams.
 */
"use client";

import dynamic from "next/dynamic";

// Dynamic import ssr:false : évite la contrainte Suspense de useSearchParams
// en export statique tout en conservant le fonctionnement côté client.
const FeedbackPageClient = dynamic(
  () => import("./FeedbackPageClient").then((m) => m.FeedbackPageClient),
  { ssr: false }
);

export default function FeedbackPage() {
  return <FeedbackPageClient />;
}
