/**
 * KIOSK-004 — ConfirmationPageClient
 * Client component that reads URL search params.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { ConfirmationScreen } from "@/components/ConfirmationScreen";

export function ConfirmationPageClient() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get("serviceId") ?? "";
  // MODEL-KIOSK-A : opération choisie (parcours 2 niveaux) — optionnelle.
  const operationId = searchParams.get("operationId") ?? undefined;
  const agencyId = searchParams.get("agencyId") ?? "";

  return (
    <ConfirmationScreen
      serviceId={serviceId}
      operationId={operationId}
      agencyId={agencyId}
    />
  );
}
