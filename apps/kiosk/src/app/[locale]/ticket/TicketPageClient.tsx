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
  // KIOSK-007 : statut imprimante + réseau coupé après 201 propagés par l'URL.
  const printerStatusParam = searchParams.get("printerStatus");
  const printerStatus =
    printerStatusParam === "OK" ||
    printerStatusParam === "PAPER_LOW" ||
    printerStatusParam === "ERROR" ||
    printerStatusParam === "OFFLINE"
      ? printerStatusParam
      : undefined;
  const networkLostBeforePrinterConfirm =
    searchParams.get("networkLostBeforePrinterConfirm") === "true";

  return (
    <TicketScreen
      displayNumber={displayNumber}
      position={position}
      estimatedWaitMinutes={estimatedWaitMinutes}
      phoneNumber={phoneNumber}
      smsConsent={smsConsent}
      printerStatus={printerStatus}
      networkLostBeforePrinterConfirm={networkLostBeforePrinterConfirm}
    />
  );
}
