/**
 * KIOSK-005 — Client component for ticket page.
 *
 * Boucle 2 F4 (S6) : la PII (téléphone, consentement SMS) ne transite PLUS par
 * l'URL — elle est relue depuis le store mémoire (`ticket-moment-store`),
 * purgé après affichage/timeout. L'URL ne porte que les données publiques du
 * Moment Ticket.
 *
 * Dégradation propre :
 *  - rechargement de page → store vide : le ticket s'affiche sans la ligne
 *    SMS, jamais de crash ;
 *  - visite directe de /ticket sans ticket dans l'URL → retour accueil.
 */
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import { TicketScreen } from "@/components/TicketScreen";
import { readTicketMomentPii, purgeTicketMomentPii } from "@/lib/ticket-moment-store";

export function TicketPageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const params = useParams();
  const currentLocale = (params?.locale as string) ?? "fr";

  // S6 : PII lue UNE fois depuis le store mémoire (jamais depuis l'URL),
  // puis purgée au départ de l'écran.
  const [pii] = useState(() => readTicketMomentPii());
  useEffect(() => {
    return () => {
      purgeTicketMomentPii();
    };
  }, []);

  const displayNumber = searchParams.get("displayNumber");
  const position = parseInt(searchParams.get("position") ?? "0", 10);
  const estimatedWaitMinutes = parseInt(searchParams.get("estimatedWaitMinutes") ?? "0", 10);
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

  // S6 : aucune donnée de ticket (visite directe/historique) → retour accueil.
  const hasTicket = displayNumber !== null;
  useEffect(() => {
    if (!hasTicket) {
      router.replace(`/${currentLocale}`);
    }
  }, [hasTicket, router, currentLocale]);

  if (!hasTicket) {
    return null;
  }

  return (
    <TicketScreen
      displayNumber={displayNumber}
      position={position}
      estimatedWaitMinutes={estimatedWaitMinutes}
      phoneNumber={pii?.phoneNumber}
      smsConsent={pii?.smsConsent ?? false}
      printerStatus={printerStatus}
      networkLostBeforePrinterConfirm={networkLostBeforePrinterConfirm}
    />
  );
}
