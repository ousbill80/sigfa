/** Entrée du journal de sync */
export interface SyncEntry {
  /** Type d'opération */
  type: string;
  /** Payload de l'opération */
  payload: Record<string, unknown>;
  /** Timestamp d'enregistrement */
  recordedAt: number;
}

/** Simulateur réseau injectable (on/off) */
export interface NetworkSimulator {
  /** Retourne true si le réseau est en ligne */
  isOnline: () => boolean;
  /** Coupe le réseau */
  goOffline: () => void;
  /** Rétablit le réseau */
  goOnline: () => void;
}

/** Journal de rejeu de sync pour vérifier l'idempotence */
export interface SyncReplayJournal {
  /** Enregistre un appel dans le journal */
  record: (entry: Omit<SyncEntry, "recordedAt">) => Promise<void>;
  /** Rejoue toutes les entrées du journal (retourne les entrées) */
  replay: () => Promise<SyncEntry[]>;
  /** Retourne toutes les entrées enregistrées */
  getEntries: () => SyncEntry[];
}

/**
 * Crée un simulateur réseau injectable.
 * @returns NetworkSimulator avec goOffline()/goOnline()/isOnline()
 */
export function createNetworkSimulator(): NetworkSimulator {
  let online = true;

  return {
    isOnline: (): boolean => online,
    goOffline: (): void => {
      online = false;
    },
    goOnline: (): void => {
      online = true;
    },
  };
}

/**
 * Crée un journal de rejeu de sync.
 * Structure d'appels enregistrée pour vérifier l'idempotence.
 * @returns SyncReplayJournal avec record()/replay()/getEntries()
 */
export function createSyncReplayJournal(): SyncReplayJournal {
  const entries: SyncEntry[] = [];

  return {
    record: async (entry: Omit<SyncEntry, "recordedAt">): Promise<void> => {
      entries.push({
        ...entry,
        recordedAt: Date.now(),
      });
    },

    replay: async (): Promise<SyncEntry[]> => {
      // Retourne toutes les entrées (idempotent : pas de dédoublonnage ici,
      // l'assertion côté test vérifie que les mêmes N entrées sont retournées)
      return [...entries];
    },

    getEntries: (): SyncEntry[] => [...entries],
  };
}
