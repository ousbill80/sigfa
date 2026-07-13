/**
 * NOTIF-005-B — service catalog for the PWA ticket flow.
 *
 * The public contract (CONTRACT-003) exposes operations for a given `serviceId`
 * but has NO public "services list" route. Like the kiosk (which receives its
 * `ServiceItem[]` as configured props), the PWA presents a curated per-tenant
 * service catalog. This module holds a demo catalog + selectors; the real
 * tenant catalog can be injected later without changing the flow. No PII.
 *
 * @module lib/pwa/pwa-services
 */

/** A selectable service tile in the PWA first step. */
export interface PwaService {
  /** Service UUID sent as `serviceId` on emission (contract PublicTicketBase). */
  readonly id: string;
  /** Short code — drives icon mapping and display. */
  readonly code: string;
  /** Localized display names (FR/EN only). */
  readonly name: { readonly fr: string; readonly en: string };
  /** Estimated wait in minutes (indicative, refined by the API on emission). */
  readonly estimatedMinutes: number;
  /** Whether the service currently accepts tickets. */
  readonly isOpen: boolean;
}

/**
 * Demo tenant catalog. UUIDs are stable placeholders; a real deployment injects
 * the tenant's own catalog. Every entry is a real banking motive (no emoji).
 */
export const DEMO_SERVICES: readonly PwaService[] = [
  {
    id: "77777777-7777-4777-a777-777777777777",
    code: "OC",
    name: { fr: "Opérations de caisse", en: "Cash operations" },
    estimatedMinutes: 8,
    isOpen: true,
  },
  {
    id: "77777777-7777-4777-a777-777777777001",
    code: "OA",
    name: { fr: "Ouverture de compte", en: "Account opening" },
    estimatedMinutes: 15,
    isOpen: true,
  },
  {
    id: "77777777-7777-4777-a777-777777777002",
    code: "CR",
    name: { fr: "Crédit & financement", en: "Loans & financing" },
    estimatedMinutes: 20,
    isOpen: true,
  },
  {
    id: "77777777-7777-4777-a777-777777777003",
    code: "CL",
    name: { fr: "Conseil clientèle", en: "Customer advisory" },
    estimatedMinutes: 12,
    isOpen: false,
  },
];

/** Returns the demo catalog (kept behind a function for future tenant wiring). */
export function getServices(): readonly PwaService[] {
  return DEMO_SERVICES;
}

/** Finds a service by id, or `undefined`. */
export function findService(
  services: readonly PwaService[],
  id: string,
): PwaService | undefined {
  return services.find((s) => s.id === id);
}

/** Resolves a service's display name for a locale. */
export function serviceName(service: PwaService, locale: "fr" | "en"): string {
  return service.name[locale];
}
