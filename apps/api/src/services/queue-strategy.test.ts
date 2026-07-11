/**
 * Tests unitaires — API-003 : interface TicketSelector + selectNextFifo (typage).
 *
 * Le comportement SQL (FIFO, rank, longueur) est couvert par tickets.test.ts
 * contre une vraie PG. Ici on verrouille le TYPAGE strict de l'interface et le
 * fait que `selectNextFifo` la respecte, sans conteneur.
 *
 * Nommage : `API-003: <description>`
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  selectNextFifo,
  computePosition,
  queueLength,
  type TicketSelector,
  type SelectedTicket,
  type Tx,
} from "src/services/queue-strategy.js";

/** Faux Tx capturant la requête émise. */
function fakeTx(rows: unknown[]): { tx: Tx; lastSql: () => string } {
  let sql = "";
  const tx = {
    query: (text: string) => {
      sql = text;
      return Promise.resolve({ rows });
    },
  } as unknown as Tx;
  return { tx, lastSql: () => sql };
}

describe("API-003: queue-strategy", () => {
  it("API-003: TicketSelector interface + selectNextFifo respecte le typage strict", async () => {
    // Vérifie l'assignabilité au type TicketSelector (typage vérifié à la compilation)
    const selector: TicketSelector = selectNextFifo;
    const { tx } = fakeTx([]);
    const result = await selector("q1", "c1", tx);
    expect(result).toBeNull();
  });

  it("API-003: selectNextFifo retourne un SelectedTicket mappé quand un WAITING existe", async () => {
    const issuedAt = new Date("2026-07-11T08:00:00Z");
    const { tx, lastSql } = fakeTx([
      { id: "t1", queue_id: "q1", service_id: "s1", status: "WAITING", priority: "STANDARD", issued_at: issuedAt },
    ]);
    const result = await selectNextFifo("q1", "c1", tx);
    const expected: SelectedTicket = {
      id: "t1", queueId: "q1", serviceId: "s1", status: "WAITING", priority: "STANDARD", issuedAt,
    };
    expect(result).toEqual(expected);
    // FIFO ordonné priority DESC puis issued_at, avec verrou concurrent
    expect(lastSql()).toContain("ORDER BY priority DESC, issued_at ASC");
    expect(lastSql()).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("API-003: computePosition utilise rank() OVER (PARTITION BY queue_id ORDER BY priority DESC, issued_at)", async () => {
    const { tx, lastSql } = fakeTx([{ position: "3" }]);
    const pos = await computePosition("t1", tx);
    expect(pos).toBe(3);
    expect(lastSql()).toContain("rank() OVER");
    expect(lastSql()).toContain("PARTITION BY queue_id");
    expect(lastSql()).toContain("ORDER BY priority DESC, issued_at");
  });

  it("API-003: computePosition → 0 si le ticket n'est plus WAITING", async () => {
    const { tx } = fakeTx([]);
    expect(await computePosition("t1", tx)).toBe(0);
  });

  it("API-003: queueLength retourne le nombre de WAITING", async () => {
    const { tx } = fakeTx([{ n: 7 }]);
    expect(await queueLength("q1", tx)).toBe(7);
  });
});
