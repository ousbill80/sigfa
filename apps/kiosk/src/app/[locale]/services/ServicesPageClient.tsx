/**
 * KIOSK-003 / AUDIT-F24 — ServicesPageClient
 * Résout les services affichés par l'écran de prise de ticket.
 *
 * Nominal : services de démo statiques (export statique, parité historique de
 * `page.tsx` — en production ils seront servis par l'API).
 *
 * AUDIT-F24 : en mode démo MSW (`NEXT_PUBLIC_ENABLE_MSW=1`) UNIQUEMENT, le
 * paramètre `?demo=affluence` charge la fixture `DEMO_AFFLUENCE_SERVICES`
 * (src/mocks/handlers.ts) pour rendre la bannière « file longue » (KIOSK-007,
 * seuil 30 min) vérifiable visuellement. L'import est DYNAMIQUE et gardé par
 * l'inlining Next de `NEXT_PUBLIC_ENABLE_MSW` : en build réel la branche est
 * morte, zéro octet de fixture/MSW dans le static export (même garantie que
 * MswProvider).
 */
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getKioskSession } from "@/lib/kiosk-session-store";
import { ServicesScreen } from "@/components/ServicesScreen";
import type { ServiceItem } from "@/components/ServicesScreen";

/** Agence par défaut en démo/dev (parité avec la page conseillers). */
const DEFAULT_AGENCY_ID = "agt-001";

// Services de démo par défaut pour l'export statique.
// En production, ils seront récupérés depuis l'API.
// KIOSK-BORNE / AUDIT-F7 : catalogue de démo calqué sur une borne réelle
// (BNI) — 3 FAMILLES dont les opérations distinctes sont servies par les
// mocks MSW (DEMO_OPERATIONS_BY_SERVICE, filtrage par serviceId) ; assez de
// tuiles pour que le défilement (et son affordance de continuation) soit
// visible en revue visuelle, à 1024×768 comme à 1920×1080.
const DEFAULT_SERVICES: ServiceItem[] = [
  { id: "svc-caisse", name: "Caisse", code: "cash", estimatedMinutes: 8, isOpen: true },
  { id: "svc-moyens-paiement", name: "Moyen de paiement", code: "card", estimatedMinutes: 10, isOpen: true },
  { id: "svc-conseiller", name: "Accueil / Conseiller client", code: "advisor", estimatedMinutes: 15, isOpen: true },
];

export function ServicesPageClient() {
  const searchParams = useSearchParams();
  const [services, setServices] = useState<ServiceItem[]>(DEFAULT_SERVICES);
  const agencyId = getKioskSession()?.agencyId ?? DEFAULT_AGENCY_ID;
  const isAffluenceDemo = searchParams?.get("demo") === "affluence";

  useEffect(() => {
    // Garde d'inlining : hors mode démo MSW, `NEXT_PUBLIC_ENABLE_MSW` est
    // remplacé au build → retour anticipé constant, l'import dynamique de la
    // fixture est éliminé du bundle (cf. MswProvider pour le même motif).
    if (process.env.NEXT_PUBLIC_ENABLE_MSW !== "1") return;
    if (!isAffluenceDemo) return;

    let cancelled = false;
    void import("@/mocks/handlers").then(({ DEMO_AFFLUENCE_SERVICES }) => {
      if (!cancelled) setServices(DEMO_AFFLUENCE_SERVICES);
    });
    return () => {
      cancelled = true;
    };
  }, [isAffluenceDemo]);

  return <ServicesScreen services={services} agencyId={agencyId} />;
}
