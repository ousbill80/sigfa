/**
 * MODEL-KIOSK-A — OperationsPageClient
 * Lit les search params (serviceId, agencyId) pour l'écran opérations.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { OperationsScreen } from "@/components/OperationsScreen";

export function OperationsPageClient() {
  const searchParams = useSearchParams();
  const serviceId = searchParams.get("serviceId") ?? "";
  const agencyId = searchParams.get("agencyId") ?? "";

  return <OperationsScreen serviceId={serviceId} agencyId={agencyId} />;
}
