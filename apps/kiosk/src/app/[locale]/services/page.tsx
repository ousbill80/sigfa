/**
 * KIOSK-003 — app/[locale]/services/page.tsx
 * Page de sélection de service.
 */
import { ServicesScreen } from "@/components/ServicesScreen";
import type { ServiceItem } from "@/components/ServicesScreen";

// Default placeholder services for the static export
// In production these would be fetched from the API
const DEFAULT_SERVICES: ServiceItem[] = [
  { id: "svc-1", name: "Dépôt", icon: "💰", estimatedMinutes: 5, isOpen: true },
  { id: "svc-2", name: "Retrait", icon: "💵", estimatedMinutes: 8, isOpen: true },
  { id: "svc-3", name: "Virement", icon: "🔄", estimatedMinutes: 12, isOpen: true },
  { id: "svc-4", name: "Réclamation", icon: "📋", estimatedMinutes: 15, isOpen: true },
];

export default function ServicesPage() {
  return <ServicesScreen services={DEFAULT_SERVICES} agencyId="agt-001" />;
}
