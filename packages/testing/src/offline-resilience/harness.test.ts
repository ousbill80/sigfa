import { describe, it, expect } from "vitest";
import {
  createNetworkSimulator,
  createSyncReplayJournal,
  type NetworkSimulator,
  type SyncReplayJournal,
} from "./harness.js";

describe("INFRA-005: harness offline-resilience", () => {
  it(
    "INFRA-005: harness offline — simulateur coupe/rétablit, le journal d'appels permet d'asserter un double-rejeu",
    async () => {
      const network: NetworkSimulator = createNetworkSimulator();
      const journal: SyncReplayJournal = createSyncReplayJournal();

      // Réseau en ligne
      expect(network.isOnline()).toBe(true);

      // Enregistre un appel
      await journal.record({ type: "CREATE_TICKET", payload: { id: "t-1" } });

      // Coupe le réseau
      network.goOffline();
      expect(network.isOnline()).toBe(false);

      // Enregistre un autre appel pendant l'offline
      await journal.record({ type: "CREATE_TICKET", payload: { id: "t-2" } });

      // Rétablit le réseau
      network.goOnline();
      expect(network.isOnline()).toBe(true);

      // Rejoue le journal
      const replayed = await journal.replay();
      expect(replayed).toHaveLength(2);

      // Double rejeu (idempotence : ne doit pas dupliquer si déjà rejoué)
      const replayedAgain = await journal.replay();
      expect(replayedAgain).toHaveLength(2);

      // Vérifie le journal
      const entries = journal.getEntries();
      expect(entries[0]?.payload).toEqual({ id: "t-1" });
      expect(entries[1]?.payload).toEqual({ id: "t-2" });
    }
  );
});
