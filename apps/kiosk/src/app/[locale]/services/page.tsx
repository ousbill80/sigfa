/**
 * KIOSK-003 — app/[locale]/services/page.tsx
 * Page de sélection de service.
 *
 * AUDIT-F7 : le catalogue de démo est calqué sur une borne réelle (BNI) —
 * assez de services pour que le défilement (et son affordance de
 * continuation) soit visible en revue visuelle, à 1024×768 comme à 1920×1080.
 */
import { ServicesScreen } from "@/components/ServicesScreen";
import type { ServiceItem } from "@/components/ServicesScreen";

// Default placeholder services for the static export
// In production these would be fetched from the API
const DEFAULT_SERVICES: ServiceItem[] = [
  { id: "svc-1", name: "Dépôt", code: "deposit", estimatedMinutes: 5, isOpen: true },
  { id: "svc-2", name: "Retrait", code: "withdrawal", estimatedMinutes: 8, isOpen: true },
  { id: "svc-3", name: "Virement", code: "transfer", estimatedMinutes: 12, isOpen: true },
  { id: "svc-4", name: "Réclamation", code: "complaint", estimatedMinutes: 15, isOpen: true },
  { id: "svc-5", name: "Change", code: "exchange", estimatedMinutes: 10, isOpen: true },
  { id: "svc-6", name: "Transfert MoneyGram", code: "transfer", estimatedMinutes: 12, isOpen: true },
  { id: "svc-7", name: "Demande de relevé", code: "account", estimatedMinutes: 6, isOpen: true },
  { id: "svc-8", name: "Carte prépayée", code: "account", estimatedMinutes: 9, isOpen: true },
  { id: "svc-9", name: "Remise chèque/effet", code: "deposit", estimatedMinutes: 7, isOpen: true },
  {
    id: "svc-10",
    name: "Crédit",
    code: "credit",
    estimatedMinutes: 20,
    isOpen: false,
    schedule: "Lu-Ve 09h-17h",
  },
];

export default function ServicesPage() {
  return <ServicesScreen services={DEFAULT_SERVICES} agencyId="agt-001" />;
}
