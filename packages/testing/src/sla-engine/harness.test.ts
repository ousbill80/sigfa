import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import {
  buildTicketTimeline,
  type TicketTimeline,
} from "./harness.js";

describe("INFRA-005: harness sla-engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    "INFRA-005: harness sla-engine — timeline construite sous fake timers, durées exactes au ms",
    () => {
      const issuedAt = new Date("2026-01-01T09:00:00.000Z");
      vi.setSystemTime(issuedAt);

      const timeline: TicketTimeline = buildTicketTimeline({ issuedAt });

      // Avance de 5 minutes = temps d'attente avant appel
      vi.advanceTimersByTime(5 * 60 * 1000);
      const calledAt = new Date();
      timeline.setCalledAt(calledAt);

      // Avance de 3 minutes = durée de service
      vi.advanceTimersByTime(3 * 60 * 1000);
      const servedAt = new Date();
      timeline.setServedAt(servedAt);

      // Avance de 1 minute = durée de clôture
      vi.advanceTimersByTime(1 * 60 * 1000);
      const closedAt = new Date();
      timeline.setClosedAt(closedAt);

      const durations = timeline.getDurations();

      // TMT (Temps Moyen de Traitement) = calledAt - issuedAt = 5 min
      expect(durations.waitingMs).toBe(5 * 60 * 1000);
      // Durée de service = servedAt - calledAt = 3 min
      expect(durations.serviceMs).toBe(3 * 60 * 1000);
      // Durée totale = closedAt - issuedAt = 9 min
      expect(durations.totalMs).toBe(9 * 60 * 1000);
    }
  );
});
