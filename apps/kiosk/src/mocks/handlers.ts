/**
 * KIOSK-001 — mocks/handlers.ts
 * Handlers MSW 2.x pour les tests kiosque.
 */
import { http, HttpResponse } from "msw";

export const handlers = [
  http.post("*/kiosk/session", () => {
    return HttpResponse.json(
      {
        accessToken: "eyJhbGciOiJIUzI1NiJ9.kioskPayload.sig",
        expiresIn: 43200,
        kioskId: "14141414-1414-4141-a141-141414141414",
        agencyId: "33333333-3333-4333-a333-333333333333",
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
  http.get("*/public/agencies/:agencyId/relationship-managers", () => {
    return HttpResponse.json(
      {
        data: [
          { id: "rm-kofi", displayName: "Kofi Aké", photoUrl: "/mock/rm/kofi.svg" },
          { id: "rm-awa", displayName: "Awa Diallo" },
          { id: "rm-yao", displayName: "Yao Kouassi", photoUrl: "/mock/rm/yao.svg" },
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
];
