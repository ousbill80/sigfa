/**
 * KIOSK-001 — mocks/handlers.ts
 * Handlers MSW 2.x pour les tests kiosque.
 */
import { http, HttpResponse } from "msw";
import type { ServiceItem } from "@/components/ServicesScreen";

export const handlers = [
  http.post("*/kiosk/session", () => {
    return HttpResponse.json(
      {
        accessToken: "eyJhbGciOiJIUzI1NiJ9.kioskPayload.sig",
        expiresIn: 43200,
        kioskId: "14141414-1414-4141-a141-141414141414",
        agencyId: "33333333-3333-4333-a333-333333333333",
        // CONTRACT-014 : bankId requis — theming (--brand, logo) depuis la
        // session, sans NEXT_PUBLIC_BANK_ID (l'env reste le repli DEV/démo).
        bankId: "22222222-2222-4222-a222-222222222222",
      },
      { status: 201 }
    );
  }),
  // MODEL-KIOSK-A: GET /public/agencies/{agencyId}/operations?serviceId=
  // Liste des opérations actives d'un service (SLA résolu) pour la grille borne.
  // Démo : ≥3 opérations réalistes (data only) pour peupler la grille sans
  // déclencher le saut « opération unique ». Le wildcard `:agencyId` matche
  // n'importe quel identifiant d'agence transmis par l'écran services.
  http.get("*/public/agencies/:agencyId/operations", () => {
    return HttpResponse.json(
      {
        data: [
          { id: "op-dep", code: "DEP", name: "Dépôt espèces", slaMinutes: 8, iconKey: "deposit" },
          { id: "op-ret", code: "RET", name: "Retrait espèces", slaMinutes: 10, iconKey: "withdrawal" },
          { id: "op-vir", code: "VIR", name: "Virement", slaMinutes: 12, iconKey: "transfer" },
          { id: "op-chq", code: "CHQ", name: "Remise de chèque", slaMinutes: 6, iconKey: "deposit" },
        ],
      },
      { status: 200 }
    );
  }),
  // MODEL-KIOSK-B: GET /public/agencies/{agencyId}/relationship-managers
  // Liste NOMINATIVE (zéro PII) des conseillers actifs d'une agence, pour le
  // chemin « voir mon conseiller ». Démo : 3 conseillers réalistes — 2 avec une
  // photo LOCALE (aucune image réseau externe), 1 sans photo (rendu en initiales
  // côté écran). Le wildcard `:agencyId` matche l'agence transmise par l'écran.
  // CONTRACT-014 (audit F14) : `available` requis — Awa est ABSENTE aujourd'hui
  // pour que le parcours démo montre les DEUX états (pill + carte désactivée).
  http.get("*/public/agencies/:agencyId/relationship-managers", () => {
    return HttpResponse.json(
      {
        data: [
          {
            id: "rm-kofi",
            displayName: "Kofi Aké",
            photoUrl: "/mock/rm/kofi.svg",
            available: true,
          },
          { id: "rm-awa", displayName: "Awa Diallo", available: false },
          {
            id: "rm-yao",
            displayName: "Yao Kouassi",
            photoUrl: "/mock/rm/yao.svg",
            available: true,
          },
        ],
      },
      { status: 200 }
    );
  }),
  // KIOSK-004: POST /public/tickets handler
  http.post("*/public/tickets", () => {
    return HttpResponse.json(
      {
        trackingId: "TRK-00001",
        number: 7,
        displayNumber: "A007",
        position: 4,
        estimatedWaitMinutes: 12,
        queueLength: 10,
        serviceId: "svc-001",
        agencyId: "agt-001",
        channel: "KIOSK",
        createdAt: new Date().toISOString(),
        status: "WAITING",
      },
      { status: 201 }
    );
  }),
  // KIOSK-HOME: GET /public/banks/{id}/theme (CONTRACT-013 — route publique,
  // zéro PII). Projection du thème tenant pour l'écran de marque de l'accueil :
  // logo + couleurs appliquées + messages de bienvenue. Démo : logo servi par
  // un asset LOCAL (public/mock/bank/logo.svg) — aucune image réseau externe.
  // Le wildcard `:id` matche l'identifiant provisionné (NEXT_PUBLIC_BANK_ID).
  http.get("*/public/banks/:id/theme", () => {
    return HttpResponse.json(
      {
        logoUrl: "/mock/bank/logo.svg",
        appliedColors: {
          primary: "#003f7f",
          secondary: "#c79a3a",
          background: "#ffffff",
        },
        welcomeMessages: {
          fr: "Bienvenue à la BNCI",
          en: "Welcome to BNCI",
        },
      },
      { status: 200 }
    );
  }),
  // AUDIT-F21 (démo feedback) — GET /public/tickets/{trackingId} : ticket DONE
  // clos il y a 1 h → l'écran feedback est ÉLIGIBLE en démo (fenêtre < 24 h).
  // Ouvrir http://localhost:3002/fr/feedback?trackingId=TRK-00001 pour vérifier
  // visuellement la notation (« Plus tard ») et le merci (compte à rebours).
  http.get("*/public/tickets/:trackingId", ({ params }) => {
    return HttpResponse.json(
      {
        trackingId: String(params.trackingId),
        number: 7,
        displayNumber: "A007",
        position: 0,
        estimatedWaitMinutes: 0,
        queueLength: 10,
        serviceId: "svc-001",
        agencyId: "agt-001",
        channel: "KIOSK",
        status: "DONE",
        createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
        closedAt: new Date(Date.now() - 3600_000).toISOString(),
      },
      { status: 200 }
    );
  }),
  // AUDIT-F21 (démo feedback) — POST /public/tickets/{trackingId}/feedback :
  // 201 → l'écran merci (compte à rebours + « Terminer ») est vérifiable en démo.
  http.post("*/public/tickets/:trackingId/feedback", () => {
    return HttpResponse.json(
      { success: true, message: "Merci pour votre avis !" },
      { status: 201 }
    );
  }),
];

/**
 * AUDIT-F24 — Fixture démo « affluence » (bannière file longue KIOSK-007).
 *
 * Les services de démo nominaux restent tous SOUS le seuil « file longue »
 * (30 min — `DEFAULT_LONG_QUEUE_THRESHOLD_MIN`) : la bannière d'affluence,
 * exigée par le gate 5 états, n'était JAMAIS vérifiable visuellement. Cette
 * fixture porte deux services au-dessus du seuil pour la déclencher.
 *
 * ACTIVATION (mode démo MSW uniquement — `NEXT_PUBLIC_ENABLE_MSW=1`) :
 *   NEXT_PUBLIC_ENABLE_MSW=1 pnpm --filter @sigfa/kiosk dev
 *   puis ouvrir http://localhost:3002/fr/services?demo=affluence
 * La page services substitue alors cette fixture aux services nominaux
 * (voir `app/[locale]/services/ServicesPageClient.tsx`). Le paramètre est
 * inerte hors mode démo : jamais actif sur une borne réelle.
 */
export const DEMO_AFFLUENCE_SERVICES: ServiceItem[] = [
  { id: "svc-1", name: "Dépôt", code: "deposit", estimatedMinutes: 35, isOpen: true },
  { id: "svc-2", name: "Retrait", code: "withdrawal", estimatedMinutes: 32, isOpen: true },
  { id: "svc-3", name: "Virement", code: "transfer", estimatedMinutes: 18, isOpen: true },
  { id: "svc-4", name: "Réclamation", code: "complaint", estimatedMinutes: 15, isOpen: true },
];
