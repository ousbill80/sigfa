/**
 * KIOSK-004 — app/[locale]/confirmation/page.tsx
 * Page de confirmation / saisie du numéro de téléphone.
 * Uses a client wrapper for useSearchParams.
 */
"use client";

import dynamic from "next/dynamic";

// Dynamic import with ssr:false avoids the useSearchParams Suspense requirement
// for static export builds while preserving client-side functionality
const ConfirmationPageClient = dynamic(
  () => import("./ConfirmationPageClient").then((m) => m.ConfirmationPageClient),
  { ssr: false }
);

export default function ConfirmationPage() {
  return <ConfirmationPageClient />;
}
