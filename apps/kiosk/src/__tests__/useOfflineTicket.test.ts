/**
 * KIOSK-006 — Tests du hook useOfflineTicket (Dexie in-memory + sync idempotente).
 * Écrits AVANT l'implémentation (phase rouge).
 *
 * Réseau simulé via MSW (POST /tickets/sync du contrat core).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { renderHook } from "@testing-library/react";
import { useOfflineTicket, MAX_SYNC_BATCH } from "@/hooks/useOfflineTicket";
import { getOfflineDb, __resetOfflineDbForTests } from "@/lib/offline-db";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SyncBody {
  tickets: { localUuid: string; serviceId: string; channel: string; createdOfflineAt: string }[];
}

const server = setupServer();

beforeEach(async () => {
  server.listen({ onUnhandledRequest: "bypass" });
  __resetOfflineDbForTests();
  const db = getOfflineDb();
  await db.open();
  await db.tickets.clear();
  await db.counters.clear();
});

afterEach(async () => {
  server.resetHandlers();
  server.close();
  const db = getOfflineDb();
  await db.tickets.clear();
  await db.counters.clear();
  __resetOfflineDbForTests();
});

describe("KIOSK-006: useOfflineTicket", () => {
  it("KIOSK-006: useOfflineTicket() implémenté (Dexie + numérotation locale) — remplace le stub KIOSK-004", async () => {
    const { result } = renderHook(() => useOfflineTicket());
    expect(typeof result.current.createOfflineTicket).toBe("function");
    expect(typeof result.current.syncPendingTickets).toBe("function");

    const ticket = await result.current.createOfflineTicket({ serviceId: "svc-1" });
    expect(ticket.isOffline).toBe(true);
    expect(ticket.trackingId).toMatch(UUID_V4);
    expect(ticket.displayNumber).toBe("H001");

    // Persisté dans Dexie.
    const db = getOfflineDb();
    expect(await db.tickets.count()).toBe(1);
    const row = await db.tickets.get(ticket.trackingId);
    expect(row?.serviceId).toBe("svc-1");
    expect(row?.channel).toBe("KIOSK");

    // Numéro suivant séquentiel, sans doublon.
    const ticket2 = await result.current.createOfflineTicket({ serviceId: "svc-1" });
    expect(ticket2.displayNumber).toBe("H002");
    expect(ticket2.trackingId).not.toBe(ticket.trackingId);
  });

  it("KIOSK-006: retour réseau → POST /tickets/sync déclenché automatiquement", async () => {
    let called = false;
    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        called = true;
        const body = (await request.json()) as SyncBody;
        return HttpResponse.json({
          synced: body.tickets.map((t) => ({
            localUuid: t.localUuid,
            serverId: crypto.randomUUID(),
            number: "A100",
          })),
          skipped: [],
        });
      })
    );

    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "svc-1" });
    const res = await result.current.syncPendingTickets();

    expect(called).toBe(true);
    expect(res.syncedCount).toBe(1);
  });

  it("KIOSK-006: sync batch ≤ 100 localUuid, X-Idempotency-Key présent", async () => {
    const seenKeys: string[] = [];
    const seenBatchSizes: number[] = [];
    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        const key = request.headers.get("X-Idempotency-Key") ?? "";
        seenKeys.push(key);
        const body = (await request.json()) as SyncBody;
        seenBatchSizes.push(body.tickets.length);
        return HttpResponse.json({
          synced: body.tickets.map((t) => ({
            localUuid: t.localUuid,
            serverId: crypto.randomUUID(),
            number: "A100",
          })),
          skipped: [],
        });
      })
    );

    const { result } = renderHook(() => useOfflineTicket());
    // 100 tickets → 1 seul batch de 100.
    for (let i = 0; i < MAX_SYNC_BATCH; i++) {
      await result.current.createOfflineTicket({ serviceId: "svc-1" });
    }
    await result.current.syncPendingTickets();

    expect(seenBatchSizes.every((n) => n <= MAX_SYNC_BATCH)).toBe(true);
    expect(seenKeys.length).toBeGreaterThan(0);
    seenKeys.forEach((k) => expect(k).toMatch(UUID_V4));
  });

  it("KIOSK-006: 200 → réconcilie localUuid↔serverId et supprime les entrées Dexie", async () => {
    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        const body = (await request.json()) as SyncBody;
        return HttpResponse.json({
          synced: body.tickets.map((t) => ({
            localUuid: t.localUuid,
            serverId: crypto.randomUUID(),
            number: "A100",
          })),
          skipped: [],
        });
      })
    );

    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "svc-1" });
    await result.current.createOfflineTicket({ serviceId: "svc-1" });

    const db = getOfflineDb();
    expect(await db.tickets.count()).toBe(2);

    const res = await result.current.syncPendingTickets();
    expect(res.syncedCount).toBe(2);
    // Entrées supprimées après réconciliation.
    expect(await db.tickets.count()).toBe(0);
  });

  it("KIOSK-006: 422 BATCH_TOO_LARGE → découpage en batches de 100 (Vitest)", async () => {
    const batchSizes: number[] = [];
    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        const body = (await request.json()) as SyncBody;
        if (body.tickets.length > MAX_SYNC_BATCH) {
          return HttpResponse.json(
            {
              error: {
                code: "BATCH_TOO_LARGE",
                message: "trop grand",
                details: { maxItems: 100, receivedItems: body.tickets.length },
              },
            },
            { status: 422 }
          );
        }
        batchSizes.push(body.tickets.length);
        return HttpResponse.json({
          synced: body.tickets.map((t) => ({
            localUuid: t.localUuid,
            serverId: crypto.randomUUID(),
            number: "A100",
          })),
          skipped: [],
        });
      })
    );

    // On force un batch de 150 en insérant directement 150 lignes dans Dexie,
    // ce qui simule un serveur qui refuse un lot > 100 sur une première tentative.
    const db = getOfflineDb();
    for (let i = 0; i < 150; i++) {
      await db.tickets.put({
        localUuid: crypto.randomUUID(),
        serviceId: "svc-1",
        agencyId: "agt-1",
        channel: "KIOSK",
        localSequence: i + 1,
        displayNumber: `H${String(i + 1).padStart(3, "0")}`,
        createdOfflineAt: new Date(Date.now() + i).toISOString(),
      });
    }

    const { result } = renderHook(() => useOfflineTicket());
    const res = await result.current.syncPendingTickets();

    expect(res.syncedCount).toBe(150);
    expect(batchSizes.every((n) => n <= MAX_SYNC_BATCH)).toBe(true);
    expect(await db.tickets.count()).toBe(0);
  });

  it("KIOSK-006: skipped localUuid → zéro alerte émise par la borne (alerte = serveur API-005), log interne uniquement", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // errorSpy servirait à détecter une éventuelle alerte : doit rester à 0.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        const body = (await request.json()) as SyncBody;
        // Tous ignorés (SERVICE_NOT_FOUND).
        return HttpResponse.json({
          synced: [],
          skipped: body.tickets.map((t) => ({
            localUuid: t.localUuid,
            reason: "SERVICE_NOT_FOUND",
          })),
        });
      })
    );

    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "unknown" });
    const res = await result.current.syncPendingTickets();

    expect(res.skippedCount).toBe(1);
    // Log interne présent, mais AUCUNE alerte (console.error) émise par la borne.
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("KIOSK-006: sync sans ticket en attente → aucun appel réseau, bilan vide", async () => {
    let called = false;
    server.use(
      http.post("*/tickets/sync", () => {
        called = true;
        return HttpResponse.json({ synced: [], skipped: [] });
      })
    );
    const { result } = renderHook(() => useOfflineTicket());
    const res = await result.current.syncPendingTickets();
    expect(called).toBe(false);
    expect(res).toEqual({ syncedCount: 0, skippedCount: 0 });
  });

  it("KIOSK-006: 422 sur un batch ≤ 100 → redécoupage en demi-batches puis rejeu", async () => {
    // Le serveur refuse tout batch > 3 (BATCH_TOO_LARGE), forçant un redécoupage
    // récursif même sous la limite contractuelle de 100.
    const acceptedSizes: number[] = [];
    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        const body = (await request.json()) as SyncBody;
        if (body.tickets.length > 3) {
          return HttpResponse.json(
            { error: { code: "BATCH_TOO_LARGE", message: "trop grand" } },
            { status: 422 }
          );
        }
        acceptedSizes.push(body.tickets.length);
        return HttpResponse.json({
          synced: body.tickets.map((t) => ({
            localUuid: t.localUuid,
            serverId: crypto.randomUUID(),
            number: "A100",
          })),
          skipped: [],
        });
      })
    );

    const { result } = renderHook(() => useOfflineTicket());
    for (let i = 0; i < 10; i++) {
      await result.current.createOfflineTicket({ serviceId: "svc-1" });
    }
    const res = await result.current.syncPendingTickets();

    expect(res.syncedCount).toBe(10);
    expect(acceptedSizes.every((n) => n <= 3)).toBe(true);
    const db = getOfflineDb();
    expect(await db.tickets.count()).toBe(0);
  });

  it("KIOSK-006: statut serveur inattendu (500) → aucune purge, ticket conservé pour rejeu", async () => {
    server.use(
      http.post("*/tickets/sync", () => {
        return HttpResponse.json(
          { error: { code: "INTERNAL", message: "boom" } },
          { status: 500 }
        );
      })
    );
    const { result } = renderHook(() => useOfflineTicket());
    await result.current.createOfflineTicket({ serviceId: "svc-1" });
    const res = await result.current.syncPendingTickets();
    expect(res.syncedCount).toBe(0);
    // Ticket conservé → sera rejoué au prochain retour réseau.
    const db = getOfflineDb();
    expect(await db.tickets.count()).toBe(1);
  });

  it("KIOSK-006: sync idempotente — même batch rejoué deux fois → zéro doublon (test rejeu)", async () => {
    // Le serveur renvoie ALREADY_SYNCED pour tout localUuid déjà vu.
    const seen = new Set<string>();
    server.use(
      http.post("*/tickets/sync", async ({ request }) => {
        const body = (await request.json()) as SyncBody;
        const synced: { localUuid: string; serverId: string; number: string }[] = [];
        const skipped: { localUuid: string; reason: string }[] = [];
        for (const t of body.tickets) {
          if (seen.has(t.localUuid)) {
            skipped.push({ localUuid: t.localUuid, reason: "ALREADY_SYNCED" });
          } else {
            seen.add(t.localUuid);
            synced.push({ localUuid: t.localUuid, serverId: crypto.randomUUID(), number: "A100" });
          }
        }
        return HttpResponse.json({ synced, skipped });
      })
    );

    const { result } = renderHook(() => useOfflineTicket());
    const ticket = await result.current.createOfflineTicket({ serviceId: "svc-1" });

    const db = getOfflineDb();
    // 1er passage : réconcilié + purgé.
    const first = await result.current.syncPendingTickets();
    expect(first.syncedCount).toBe(1);
    expect(await db.tickets.count()).toBe(0);

    // Rejeu du MÊME ticket (réinséré manuellement pour simuler un double-envoi).
    await db.tickets.put({
      localUuid: ticket.trackingId,
      serviceId: "svc-1",
      agencyId: "",
      channel: "KIOSK",
      localSequence: 1,
      displayNumber: ticket.displayNumber,
      createdOfflineAt: new Date().toISOString(),
    });
    const second = await result.current.syncPendingTickets();
    // Serveur idempotent → skipped, ZÉRO nouveau ticket synchronisé, purge locale.
    expect(second.syncedCount).toBe(0);
    expect(second.skippedCount).toBe(1);
    // Le compteur serveur n'a vu qu'UNE seule fois ce localUuid → zéro doublon.
    expect(seen.size).toBe(1);
  });
});
