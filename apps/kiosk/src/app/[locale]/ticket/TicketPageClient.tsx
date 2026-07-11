/**
 * KIOSK-005 — Client component for ticket page
 * Reads URL search params for ticket data.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { TicketScreen } from "@/components/TicketScreen";

export function TicketPageClient() {
  const searchParams = useSearchParams();
  const displayNumber = searchParams.get("displayNumber") ?? "---";
  const position = parseInt(searchParams.get("position") ?? "0", 10);
  const estimatedWaitMinutes = parseInt(searchParams.get("estimatedWaitMinutes") ?? "0", 10);
  const phoneNumber = searchParams.get("phoneNumber") ?? undefined;
  const smsConsentStr = searchParams.get("smsConsent");
  const smsConsent = smsConsentStr === "true";

  return (
    <TicketScreen
      displayNumber={displayNumber}
      position={position}
      estimatedWaitMinutes={estimatedWaitMinutes}
      phoneNumber={phoneNumber}
      smsConsent={smsConsent}
    />
  );
}
