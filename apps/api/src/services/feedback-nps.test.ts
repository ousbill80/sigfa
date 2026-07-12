/**
 * Tests unitaires — mapping NPS (API-010).
 *
 * Le chemin d'upsert incrémental idempotent (`incrementDailyNps`) est couvert
 * end-to-end par `routes/public-tickets.test.ts` (PG réel). Ici : le mapping pur
 * note→bucket, source de la convention SIGFA.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { npsBucket } from "src/services/feedback-nps.js";

describe("API-010: mapping NPS note→bucket", () => {
  it("API-010: note 5 → promoter", () => {
    expect(npsBucket(5)).toBe("nps_promoters");
  });

  it("API-010: note 4 → passive", () => {
    expect(npsBucket(4)).toBe("nps_passives");
  });

  it("API-010: note 3, 2, 1 → detractor", () => {
    expect(npsBucket(3)).toBe("nps_detractors");
    expect(npsBucket(2)).toBe("nps_detractors");
    expect(npsBucket(1)).toBe("nps_detractors");
  });
});
