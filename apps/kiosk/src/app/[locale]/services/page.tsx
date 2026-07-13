/**
 * KIOSK-003 — app/[locale]/services/page.tsx
 * Page de sélection de service.
 */
import { ServicesScreen } from "@/components/ServicesScreen";
import type { ServiceItem } from "@/components/ServicesScreen";

// Familles de démo pour l'export statique — catalogue borne BNI modèle
// (3 familles, opérations distinctes servies par les mocks MSW).
// En production, ces services sont récupérés depuis l'API.
const DEFAULT_SERVICES: ServiceItem[] = [
  { id: "svc-caisse", name: "Caisse", code: "cash", estimatedMinutes: 8, isOpen: true },
  { id: "svc-moyens-paiement", name: "Moyen de paiement", code: "card", estimatedMinutes: 10, isOpen: true },
  { id: "svc-conseiller", name: "Accueil / Conseiller client", code: "advisor", estimatedMinutes: 15, isOpen: true },
];

export default function ServicesPage() {
  return <ServicesScreen services={DEFAULT_SERVICES} agencyId="agt-001" />;
}
