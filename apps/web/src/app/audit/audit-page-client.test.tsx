/**
 * Tests for AuditPageClient (SEC-001b) — read-only audit trail shell.
 *
 * Régression E2E-CRITICAL-JOURNEYS-2 : le chargement initial (filtres vides) doit
 * s'exécuter EXACTEMENT UNE FOIS au montage. `refresh` (issu de useAuditLog)
 * change d'identité à chaque fetch ; s'il pilotait l'effet initial, appliquer un
 * filtre le rejouerait avec des filtres VIDES → boucle infinie qui clobbe le
 * filtre utilisateur et fige l'écran en « chargement ». Ces tests prouvent que :
 *   (1) un filtre appliqué frappe l'API AVEC le paramètre (jamais réinitialisé) ;
 *   (2) le chargement initial ne se rejoue pas en boucle (nombre d'appels borné).
 * @module app/audit/audit-page-client.test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw-server";
import { AuditPageClient } from "./audit-page-client";

const BASE = "http://localhost:4010";
const TICKET_ID = "f900fdcb-0df9-445f-a46c-7614866bce9e";

/** Une entrée d'audit conforme au contrat (POST /tickets sur une entité ticket). */
const TICKET_ENTRY = {
  actor: { id: "agent-1", role: "AGENT", email: "agent@oc.ci" },
  action: "POST /tickets",
  entityType: "ticket",
  entityId: TICKET_ID,
  timestamp: "2026-07-14T09:00:00.000Z",
  ip: "10.0.0.1",
};

afterEach(() => {
  server.resetHandlers();
});

describe("SEC-001b: AuditPageClient — chargement initial + filtres (régression boucle)", () => {
  it("SEC-001b: le filtre entityId frappe l'API avec le paramètre (jamais réinitialisé)", async () => {
    const seenQueries: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/audit-logs`, ({ request }) => {
        const url = new URL(request.url);
        const entityId = url.searchParams.get("entityId");
        seenQueries.push(entityId);
        // Sans filtre → 1 entrée ; filtré sur l'entité → la même entrée.
        const data = entityId && entityId !== TICKET_ID ? [] : [TICKET_ENTRY];
        return HttpResponse.json({ data, meta: { page: 1, limit: 20, total: data.length } });
      }),
    );

    render(<AuditPageClient apiBase={BASE} />);

    // Chargement initial (sans filtre) → la table apparaît avec la ligne.
    await waitFor(() => expect(screen.getByTestId("audit-table")).toBeInTheDocument());
    expect(screen.getAllByTestId("audit-row")).toHaveLength(1);

    // Applique un filtre entityId puis relance la lecture.
    const field = screen.getByTestId("audit-filter-entityId");
    await userEvent.type(field, TICKET_ID);
    await userEvent.click(screen.getByTestId("audit-apply"));

    // La requête filtrée est bien partie AVEC l'entityId — pas clobbée à vide.
    await waitFor(() => expect(seenQueries).toContain(TICKET_ID));
    // La table reste visible avec l'entrée ciblée (filtre honoré, pas de reset).
    await waitFor(() => expect(screen.getByTestId("audit-table")).toBeInTheDocument());
    expect(screen.getAllByTestId("audit-row")).toHaveLength(1);
  });

  it("SEC-001b: le chargement initial ne boucle pas (nombre d'appels borné)", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/audit-logs`, () => {
        calls += 1;
        return HttpResponse.json({
          data: [TICKET_ENTRY],
          meta: { page: 1, limit: 20, total: 1 },
        });
      }),
    );

    render(<AuditPageClient apiBase={BASE} />);
    await waitFor(() => expect(screen.getByTestId("audit-table")).toBeInTheDocument());

    // Laisse le temps à un éventuel effet en boucle de se manifester.
    await new Promise((r) => setTimeout(r, 200));
    // Un seul chargement initial : l'effet ne se rejoue pas en boucle.
    expect(calls).toBe(1);
  });
});
