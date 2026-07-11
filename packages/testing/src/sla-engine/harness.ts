/** Durées calculées depuis la timeline d'un ticket */
export interface TicketDurations {
  /** Temps d'attente avant appel (calledAt - issuedAt) en ms */
  waitingMs: number;
  /** Durée de service (servedAt - calledAt) en ms */
  serviceMs: number;
  /** Durée totale (closedAt - issuedAt) en ms */
  totalMs: number;
}

/** Timeline d'un ticket pour calcul SLA/TMA/TMT */
export interface TicketTimeline {
  /** Définit l'heure d'appel du client */
  setCalledAt: (date: Date) => void;
  /** Définit l'heure de début de service */
  setServedAt: (date: Date) => void;
  /** Définit l'heure de clôture */
  setClosedAt: (date: Date) => void;
  /** Calcule et retourne les durées */
  getDurations: () => TicketDurations;
}

/** Options pour construire une timeline */
export interface BuildTimelineOptions {
  /** Date d'émission du ticket */
  issuedAt: Date;
}

/**
 * Construit une timeline de ticket pour les calculs SLA/TMA/TMT.
 * Conçu pour être utilisé sous fake timers Vitest.
 * @param options - Options avec issuedAt
 * @returns Timeline mutable
 */
export function buildTicketTimeline(options: BuildTimelineOptions): TicketTimeline {
  const { issuedAt } = options;
  let calledAt: Date | undefined;
  let servedAt: Date | undefined;
  let closedAt: Date | undefined;

  return {
    setCalledAt: (date: Date): void => {
      calledAt = date;
    },
    setServedAt: (date: Date): void => {
      servedAt = date;
    },
    setClosedAt: (date: Date): void => {
      closedAt = date;
    },
    getDurations: (): TicketDurations => {
      if (!calledAt) throw new Error("calledAt non défini");
      if (!servedAt) throw new Error("servedAt non défini");
      if (!closedAt) throw new Error("closedAt non défini");
      return {
        waitingMs: calledAt.getTime() - issuedAt.getTime(),
        serviceMs: servedAt.getTime() - calledAt.getTime(),
        totalMs: closedAt.getTime() - issuedAt.getTime(),
      };
    },
  };
}
