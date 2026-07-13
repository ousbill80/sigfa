/**
 * IA-001 — Tests unitaires de l'extraction (mapping des lignes SQL, garde bucket),
 * avec une `ReportQueryFn` fausse déterministe (sans conteneur).
 *
 * Nommage strict : `IA-001: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import type { QueryFn as ReportQueryFn } from "src/reporting/aggregate-service.js";
import { extractBucketObservations } from "src/ai/feature-extraction.js";

const BANK = "11111111-1111-4111-8111-111111111111";

describe("feature-extraction (unit)", () => {
  it("IA-001: bucketMinutes invalide → erreur explicite (garde)", async () => {
    const q: ReportQueryFn = async () => ({ rows: [] });
    await expect(
      // @ts-expect-error test volontaire d'une largeur non supportée
      extractBucketObservations(q, { bankId: BANK, dayStart: "2026-06-10", dayEnd: "2026-06-10", bucketMinutes: 15 })
    ).rejects.toThrow(/bucketMinutes invalide/);
  });

  it("IA-001: mappe les colonnes SQL en observation (p90 arrondi, jointure agents)", async () => {
    const q: ReportQueryFn = async (sql) => {
      if (sql.includes("FROM bucketed")) {
        return {
          rows: [
            {
              agency_id: "aaaaaaaa-1111-4111-8111-111111111111",
              service_id: null,
              day: "2026-06-10",
              hour_bucket: 9,
              arrivals: "5",
              served: "4",
              no_show: "0",
              abandoned: "1",
              total_wait_seconds: "480",
              total_service_seconds: "1200",
              counters_open: "2",
              p90_wait_seconds: "149.6",
            },
          ],
        };
      }
      // agent_status_history
      return {
        rows: [
          { agency_id: "aaaaaaaa-1111-4111-8111-111111111111", day: "2026-06-10", hour_bucket: 9, agents_active: "3" },
        ],
      };
    };
    const obs = await extractBucketObservations(q, {
      bankId: BANK,
      dayStart: "2026-06-10",
      dayEnd: "2026-06-10",
    });
    expect(obs).toHaveLength(1);
    const o = obs[0]!;
    expect(o.arrivals).toBe(5);
    expect(o.served).toBe(4);
    expect(o.abandoned).toBe(1);
    expect(o.countersOpen).toBe(2);
    expect(o.p90WaitSeconds).toBe(150); // 149.6 arrondi
    expect(o.agentsActive).toBe(3); // jointure occupation
    expect(o.serviceId).toBeNull();
    expect(o.isPartialSource).toBe(false);
  });

  it("IA-001: byService=true conserve le service_id de la ligne", async () => {
    const q: ReportQueryFn = async (sql) => {
      if (sql.includes("FROM bucketed")) {
        return {
          rows: [
            {
              agency_id: "aaaaaaaa-1111-4111-8111-111111111111",
              service_id: "cccccccc-1111-4111-8111-111111111111",
              day: "2026-06-10",
              hour_bucket: 9,
              arrivals: "2",
              served: "2",
              no_show: "0",
              abandoned: "0",
              total_wait_seconds: "0",
              total_service_seconds: "0",
              counters_open: "0",
              p90_wait_seconds: "0",
            },
          ],
        };
      }
      return { rows: [] };
    };
    const obs = await extractBucketObservations(q, {
      bankId: BANK,
      dayStart: "2026-06-10",
      dayEnd: "2026-06-10",
      byService: true,
    });
    expect(obs[0]?.serviceId).toBe("cccccccc-1111-4111-8111-111111111111");
    expect(obs[0]?.agentsActive).toBe(0); // pas de ligne occupation
  });
});
