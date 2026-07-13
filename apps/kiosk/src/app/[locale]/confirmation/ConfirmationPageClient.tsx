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
  // KIOSK-BORNE : libellé public de l'opération (ticket imprimé) — optionnel.
  const operationLabel = searchParams.get("operationLabel") ?? undefined;
  // MODEL-KIOSK-B : conseiller ciblé (parcours « voir mon conseiller ») — optionnel.
  const targetManagerId = searchParams.get("targetManagerId") ?? undefined;
  // MODEL-KIOSK-B (finition) : nom du conseiller (public, non-PII) pour le rappel.
  const managerName = searchParams.get("managerName") ?? undefined;
  const agencyId = searchParams.get("agencyId") ?? "";

  return (
    <ConfirmationScreen
      serviceId={serviceId}
      operationId={operationId}
      operationLabel={operationLabel}
      targetManagerId={targetManagerId}
      managerName={managerName}
      agencyId={agencyId}
    />
  );
}
