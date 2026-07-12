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
  http.get("*/public/agencies/:agencyId/operations", () => {
    return HttpResponse.json(
      {
        data: [
          { id: "op-dep", code: "DEP", name: "Dépôt espèces", slaMinutes: 8, iconKey: "deposit" },
          { id: "op-ret", code: "RET", name: "Retrait espèces", slaMinutes: 10 },
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
];
