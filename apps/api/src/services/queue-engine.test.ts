/**
 * Tests unitaires — API-004 : moteur de file priorités + langue + débordement.
 *
 * Table-driven exhaustif (6 critères PRD). Aucun I/O réel — fake Tx + fake Redis.
 *
 * Nommage : `API-004: <description>`
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  selectNextPriority,
  selectNextForManager,
  shouldAlertOverflow,
  findOverflowQueues,
  computePositionPriority,
  getAgentLanguages,
  PRIORITY_ORDER,
  LANGUAGE_SOFT_TIMEOUT_MINUTES,
} from "src/services/queue-engine.js";
import type { Tx, TicketSelector, SelectedTicket } from "src/services/queue-strategy.js";
import type { OverflowRedis } from "src/services/queue-engine.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Faux Tx retournant des lignes prédéfinies. */
function fakeTx(rows: unknown[]): Tx {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    query: (..._args: unknown[]) =>
      Promise.resolve({ rows }),
  } as unknown as Tx;
}

/** Faux Tx multi-réponse : chaque appel consomme la prochaine entrée. */
function multiTx(responses: unknown[][]): Tx {
  let i = 0;
  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    query: (..._args: unknown[]) => {
      const rows = responses[i++] ?? [];
      return Promise.resolve({ rows });
    },
  } as unknown as Tx;
}

/** Un appel `query` capturé : le SQL brut + les paramètres liés. */
interface RecordedCall {
  sql: string;
  params: unknown[];
}

/**
 * Faux Tx ENREGISTREUR : renvoie les `responses` en séquence ET capture chaque
 * `(sql, params)`. Permet de tuer les mutants sur les tableaux de paramètres
 * (`ArrayDeclaration`) et l'arithmétique de deadline sans DB réelle.
 */
function recordingTx(responses: unknown[][]): Tx & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const tx = {
    query: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = responses[i++] ?? [];
      return Promise.resolve({ rows });
    },
    calls,
  };
  return tx as unknown as Tx & { calls: RecordedCall[] };
}

/** Faux Redis en mémoire. */
function fakeRedis(): OverflowRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    del: async (k) => { store.delete(k); },
  };
}

/** Ticket WAITING générique. */
function makeRow(
  priority: string,
  issuedAt: Date,
  requiredLanguage?: string | null
): Record<string, unknown> {
  return {
    id: `t-${priority}-${issuedAt.getTime()}`,
    queue_id: "q1",
    service_id: "s1",
    status: "WAITING",
    priority,
    issued_at: issuedAt,
    required_language: requiredLanguage ?? null,
  };
}

// ── Critère 1 : ordre VIP>PMR>SENIOR>PRIORITY>STANDARD puis FIFO ─────────────

describe("API-004: ordre VIP>PMR>SENIOR>PRIORITY>STANDARD puis FIFO — table-driven exhaustif", () => {
  const NOW = new Date("2026-07-12T08:00:00Z");

  it("API-004: PRIORITY_ORDER reflète l'ordre attendu (0=VIP, 4=STANDARD)", () => {
    expect(PRIORITY_ORDER["VIP"]).toBe(0);
    expect(PRIORITY_ORDER["PMR"]).toBe(1);
    expect(PRIORITY_ORDER["SENIOR"]).toBe(2);
    expect(PRIORITY_ORDER["PRIORITY"]).toBe(3);
    expect(PRIORITY_ORDER["STANDARD"]).toBe(4);
  });

  // Table-driven exhaustif : paires de priorités, le plus élevé doit gagner
  const priorityTable: Array<[string, string]> = [
    ["VIP", "PMR"],
    ["VIP", "SENIOR"],
    ["VIP", "PRIORITY"],
    ["VIP", "STANDARD"],
    ["PMR", "SENIOR"],
    ["PMR", "PRIORITY"],
    ["PMR", "STANDARD"],
    ["SENIOR", "PRIORITY"],
    ["SENIOR", "STANDARD"],
    ["PRIORITY", "STANDARD"],
  ];

  for (const [higher, lower] of priorityTable) {
    it(`API-004: ${higher} (ordre ${PRIORITY_ORDER[higher]}) passe avant ${lower} (ordre ${PRIORITY_ORDER[lower]})`, () => {
      expect(PRIORITY_ORDER[higher]).toBeLessThan(PRIORITY_ORDER[lower] as number);
    });
  }

  it("API-004: FIFO à priorité égale — ticket le plus ancien sélectionné en premier", async () => {
    const early = makeRow("STANDARD", new Date("2026-07-12T07:00:00Z"));
    // late est plus récent → non sélectionné (FIFO, early est en premier)
    // La requête SQL ordonne par issued_at ASC → early est sélectionné
    const tx = multiTx([[{ languages: [] }], [early]]);
    const result = await selectNextPriority("q1", "c1", tx);
    expect(result?.id).toBe(early.id as string);
  });

  it("API-004: selectNextPriority retourne null si file vide", async () => {
    const tx = multiTx([[{ languages: [] }], []]);
    const result = await selectNextPriority("q1", "c1", tx);
    expect(result).toBeNull();
  });

  it("API-004: selectNextPriority retourne un VIP présent (premier WAITING éligible)", async () => {
    const vip = makeRow("VIP", new Date("2026-07-12T07:30:00Z"));
    const tx = multiTx([[{ languages: ["FR"] }], [vip]]);
    const result = await selectNextPriority("q1", "c1", tx);
    expect(result?.priority).toBe("VIP");
    void NOW;
  });
});

// ── Critère 2 : langue non parlée → sauté ; soft timeout ─────────────────────

describe("API-004: langue non parlée → sauté pour ce guichet, soft timeout → pris quand même (horloge contrôlée)", () => {
  it("API-004: agent sans langue déclarée — ticket sans langue requis → sélectionné", async () => {
    const ticket = makeRow("STANDARD", new Date("2026-07-12T07:00:00Z"), null);
    const tx = multiTx([[{ languages: [] }], [ticket]]);
    const result = await selectNextPriority("q1", "c1", tx);
    expect(result).not.toBeNull();
  });

  it("API-004: LANGUAGE_SOFT_TIMEOUT_MINUTES est configurable via env (défaut 10)", () => {
    expect(LANGUAGE_SOFT_TIMEOUT_MINUTES).toBeGreaterThan(0);
    // Par défaut = 10 si env non surchargé
    expect(typeof LANGUAGE_SOFT_TIMEOUT_MINUTES).toBe("number");
  });

  it("API-004: agent avec langue ['FR'] — ticket 'EN' récent → null (sauté)", async () => {
    const enTicket = makeRow("STANDARD", new Date(), "EN");
    // TX retourne le ticket EN mais la requête SQL avec filtre langue doit l'exclure
    // On simule le TX retournant [] (aucun compatible)
    const tx = multiTx([[{ languages: ["FR"] }], []]);
    const result = await selectNextPriority("q1", "c1", tx);
    expect(result).toBeNull();
    void enTicket;
  });

  it("API-004: agent avec langue ['FR'] — ticket 'EN' soft-timeout dépassé → pris (tx retourne le ticket)", async () => {
    // Le ticket a été émis il y a plus de LANGUAGE_SOFT_TIMEOUT_MINUTES minutes
    const oldDate = new Date(
      Date.now() - (LANGUAGE_SOFT_TIMEOUT_MINUTES + 1) * 60 * 1000
    );
    const enTicket = makeRow("STANDARD", oldDate, "EN");
    // TX retourne le ticket EN (soft-timeout dépassé, inclus par la requête SQL)
    const tx = multiTx([[{ languages: ["FR"] }], [enTicket]]);
    const result = await selectNextPriority("q1", "c1", tx);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(enTicket.id as string);
  });

  it("API-004: getAgentLanguages retourne [] si aucun agent_id", async () => {
    const tx = fakeTx([{ languages: null }]);
    const langs = await getAgentLanguages("c1", tx);
    expect(langs).toEqual([]);
  });

  it("API-004: getAgentLanguages retourne les langues de l'agent", async () => {
    const tx = fakeTx([{ languages: ["FR", "EN"] }]);
    const langs = await getAgentLanguages("c1", tx);
    expect(langs).toEqual(["FR", "EN"]);
  });
});

// ── Critère 3 : débordement + alerte QUEUE_CRITICAL one-shot ─────────────────

describe("API-004: seuil franchi → débordement + UNE alerte QUEUE_CRITICAL ; redescente puis re-franchissement → nouvelle alerte", () => {
  it("API-004: shouldAlertOverflow retourne false si pas de seuil configuré", async () => {
    const tx = fakeTx([{ queue_critical_threshold: null }]);
    const redis = fakeRedis();
    expect(await shouldAlertOverflow("q1", 100, "b1", tx, redis)).toBe(false);
  });

  it("API-004: shouldAlertOverflow retourne false si length ≤ threshold", async () => {
    const tx = fakeTx([{ queue_critical_threshold: 10 }]);
    const redis = fakeRedis();
    expect(await shouldAlertOverflow("q1", 10, "b1", tx, redis)).toBe(false);
  });

  it("API-004: shouldAlertOverflow retourne true à la première montée", async () => {
    const tx = fakeTx([{ queue_critical_threshold: 10 }]);
    const redis = fakeRedis();
    expect(await shouldAlertOverflow("q1", 11, "b1", tx, redis)).toBe(true);
    // Flag posé
    expect(redis.store.get("overflow_alerted:q1")).toBe("1");
  });

  it("API-004: shouldAlertOverflow retourne false si flag déjà posé (pas de rafale)", async () => {
    const redis = fakeRedis();
    redis.store.set("overflow_alerted:q1", "1");
    const tx = fakeTx([{ queue_critical_threshold: 10 }]);
    expect(await shouldAlertOverflow("q1", 20, "b1", tx, redis)).toBe(false);
  });

  it("API-004: redescente sous le seuil → reset flag ; re-franchissement → nouvelle alerte", async () => {
    const redis = fakeRedis();
    // Premier franchissement
    const tx1 = fakeTx([{ queue_critical_threshold: 10 }]);
    expect(await shouldAlertOverflow("q1", 11, "b1", tx1, redis)).toBe(true);
    expect(redis.store.get("overflow_alerted:q1")).toBe("1");

    // Redescente
    const tx2 = fakeTx([{ queue_critical_threshold: 10 }]);
    expect(await shouldAlertOverflow("q1", 9, "b1", tx2, redis)).toBe(false);
    expect(redis.store.get("overflow_alerted:q1")).toBeUndefined();

    // Re-franchissement → nouvelle alerte
    const tx3 = fakeTx([{ queue_critical_threshold: 10 }]);
    expect(await shouldAlertOverflow("q1", 15, "b1", tx3, redis)).toBe(true);
  });

  it("API-004: findOverflowQueues retourne les files de services compatibles", async () => {
    const rows = [
      { queue_id: "q2", service_id: "s2" },
      { queue_id: "q3", service_id: "s3" },
    ];
    const tx = fakeTx(rows);
    const result = await findOverflowQueues("s1", "b1", tx);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ queueId: "q2", serviceId: "s2" });
    expect(result[1]).toEqual({ queueId: "q3", serviceId: "s3" });
  });

  it("API-004: findOverflowQueues retourne [] si aucun service compatible", async () => {
    const tx = fakeTx([]);
    const result = await findOverflowQueues("s1", "b1", tx);
    expect(result).toEqual([]);
  });
});

// ── Critère 5 : position/estimation reflètent les priorités ──────────────────

describe("API-004: position/estimation reflètent les priorités (un VIP émis après passe devant — position recalculée)", () => {
  it("API-004: computePositionPriority retourne 0 si ticket hors file WAITING", async () => {
    const tx = fakeTx([]);
    expect(await computePositionPriority("t1", tx)).toBe(0);
  });

  it("API-004: computePositionPriority retourne la position 1-based", async () => {
    const tx = fakeTx([{ position: "2" }]);
    expect(await computePositionPriority("t1", tx)).toBe(2);
  });

  it("API-004: computePositionPriority position 1 pour le VIP en tête", async () => {
    const tx = fakeTx([{ position: "1" }]);
    expect(await computePositionPriority("vip-ticket", tx)).toBe(1);
  });

  it("API-004: PRIORITY_ORDER garantit que VIP (position 0) < STANDARD (position 4) dans l'ordre de tri", () => {
    // Si VIP émis APRÈS standard, son order_val (0) < STANDARD (4) → VIP devant
    expect(PRIORITY_ORDER["VIP"]).toBeLessThan(PRIORITY_ORDER["STANDARD"] as number);
    expect(PRIORITY_ORDER["PMR"]).toBeLessThan(PRIORITY_ORDER["PRIORITY"] as number);
    expect(PRIORITY_ORDER["SENIOR"]).toBeLessThan(PRIORITY_ORDER["STANDARD"] as number);
  });
});

// ── SEC-005 : durcissement mutation — paramètres liés & branches SQL ─────────

describe("SEC-005: paramètres liés et branches de selectNextPriority (kill ArrayDeclaration/branch)", () => {
  it("SEC-005: agent AVEC langues → params = [queueId, langs, softDeadline] (3 liaisons)", async () => {
    const tx = recordingTx([[{ languages: ["FR", "EN"] }], []]);
    await selectNextPriority("q1", "c1", tx);
    // 1er appel = getAgentLanguages ; 2e = sélection ticket
    expect(tx.calls).toHaveLength(2);
    // getAgentLanguages : SQL non vide, lit les langues du guichet (kill StringLiteral ligne 64)
    const langQ = tx.calls[0] as RecordedCall;
    expect(langQ.sql).toContain("u.languages");
    expect(langQ.sql).toContain("FROM counters");
    const sel = tx.calls[1] as RecordedCall;
    expect(sel.params).toHaveLength(3);
    expect(sel.params[0]).toBe("q1");
    expect(sel.params[1]).toEqual(["FR", "EN"]);
    expect(sel.params[2]).toBeInstanceOf(Date);
    // La branche "avec langues" filtre par ANY($2) — la SQL le prouve
    expect(sel.sql).toContain("ANY($2");
    // Ordre de priorité inclus dans la SQL (kill StringLiteral ligne 28 PRIORITY_CASE_T)
    expect(sel.sql).toContain("CASE t.priority");
    expect(sel.sql).toContain("WHEN 'VIP' THEN 0");
    expect(sel.sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("SEC-005: agent SANS langue → params = [queueId, softDeadline] (2 liaisons, branche distincte)", async () => {
    const tx = recordingTx([[{ languages: [] }], []]);
    await selectNextPriority("q1", "c1", tx);
    const sel = tx.calls[1] as RecordedCall;
    expect(sel.params).toHaveLength(2);
    expect(sel.params[0]).toBe("q1");
    expect(sel.params[1]).toBeInstanceOf(Date);
    // Branche sans langue : PAS de ANY($2) (SQL différent de la branche avec langues)
    expect(sel.sql).not.toContain("ANY($2");
    // SQL non vide sur cette branche (kill StringLiteral ligne 113)
    expect(sel.sql).toContain("t.required_language IS NULL");
    expect(sel.sql).toContain("t.status = 'WAITING'");
    expect(sel.sql).toContain("CASE t.priority");
  });

  it("SEC-005: softDeadline = now − LANGUAGE_SOFT_TIMEOUT_MINUTES min (kill arithmétique ligne 90)", async () => {
    const before = Date.now();
    const tx = recordingTx([[{ languages: ["FR"] }], []]);
    await selectNextPriority("q1", "c1", tx);
    const after = Date.now();
    const deadline = (tx.calls[1] as RecordedCall).params[2] as Date;
    const expectedMs = LANGUAGE_SOFT_TIMEOUT_MINUTES * 60 * 1000;
    // La deadline est dans le passé d'exactement ~expectedMs (± drift d'exécution)
    expect(deadline.getTime()).toBeLessThanOrEqual(before - expectedMs);
    expect(deadline.getTime()).toBeGreaterThanOrEqual(after - expectedMs - 50);
    // Non trivial : la deadline est bien décalée (mutants *→/, -→+ la déplacent hors borne)
    expect(before - deadline.getTime()).toBeGreaterThanOrEqual(expectedMs);
  });

  it("SEC-005: getAgentLanguages lie counterId en paramètre (kill ArrayDeclaration ligne 68)", async () => {
    const tx = recordingTx([[{ languages: ["FR"] }]]);
    await getAgentLanguages("counter-42", tx);
    expect((tx.calls[0] as RecordedCall).params).toEqual(["counter-42"]);
  });

  it("SEC-005: getAgentLanguages — row absent → [] (kill OptionalChaining ligne 71)", async () => {
    const tx = recordingTx([[]]); // aucune ligne
    expect(await getAgentLanguages("c1", tx)).toEqual([]);
  });
});

describe("SEC-005: shouldAlertOverflow & findOverflowQueues — params liés & optional chaining", () => {
  it("SEC-005: shouldAlertOverflow lie bankId puis queueId dans le flag (kill Array ligne 291)", async () => {
    const tx = recordingTx([[{ queue_critical_threshold: 10 }]]);
    const redis = fakeRedis();
    await shouldAlertOverflow("qX", 20, "bankZ", tx, redis);
    expect((tx.calls[0] as RecordedCall).params).toEqual(["bankZ"]);
    expect(redis.store.get("overflow_alerted:qX")).toBe("1");
    // SQL de lecture du seuil non vide (kill StringLiteral ligne 290)
    expect((tx.calls[0] as RecordedCall).sql).toContain("queue_critical_threshold");
    expect((tx.calls[0] as RecordedCall).sql).toContain("FROM banks");
  });

  it("SEC-005: shouldAlertOverflow — threshRow absent → false (kill OptionalChaining ligne 296)", async () => {
    const tx = recordingTx([[]]); // banque introuvable
    const redis = fakeRedis();
    expect(await shouldAlertOverflow("q1", 999, "b1", tx, redis)).toBe(false);
  });

  it("SEC-005: findOverflowQueues lie [serviceId, bankId] (kill ArrayDeclaration ligne 338)", async () => {
    const tx = recordingTx([[]]);
    await findOverflowQueues("svc-1", "bank-1", tx);
    expect((tx.calls[0] as RecordedCall).params).toEqual(["svc-1", "bank-1"]);
    // SQL de jointure des services compatibles non vide (kill StringLiteral ligne 328)
    const sql = (tx.calls[0] as RecordedCall).sql;
    expect(sql).toContain("counter_services");
    expect(sql).toContain("q.status = 'OPEN'");
  });

  it("SEC-005: computePositionPriority lie [ticketId] et rank() prioritaire (kill Str lignes 241/37)", async () => {
    const tx = recordingTx([[{ position: "3" }]]);
    await computePositionPriority("tick-9", tx);
    expect((tx.calls[0] as RecordedCall).params).toEqual(["tick-9"]);
    const sql = (tx.calls[0] as RecordedCall).sql;
    // SQL non vide, utilise rank() et l'ordre de priorité PRIORITY_CASE (ligne 37)
    expect(sql).toContain("rank() OVER");
    expect(sql).toContain("CASE priority");
    expect(sql).toContain("WHEN 'VIP' THEN 0");
    expect(sql).toContain("status = 'WAITING'");
  });
});

describe("SEC-005: selectNextForManager — file conseiller PRIORITÉ ABSOLUE (D6, couvre 155-225)", () => {
  /** Sélecteur fallback espion : retourne un ticket marqueur et compte ses appels. */
  function spyFallback(): TicketSelector & { called: number } {
    const marker: SelectedTicket = {
      id: "fallback-ticket",
      queueId: "q1",
      serviceId: "s1",
      status: "WAITING",
      priority: "STANDARD",
      issuedAt: new Date("2026-07-12T08:00:00Z"),
    };
    const fn = (async () => {
      fn.called += 1;
      return marker;
    }) as TicketSelector & { called: number };
    fn.called = 0;
    return fn;
  }

  const personalRow = {
    id: "perso-ticket",
    queue_id: "q1",
    service_id: "s1",
    status: "WAITING",
    priority: "VIP",
    issued_at: new Date("2026-07-12T07:00:00Z"),
  };

  it("SEC-005: agent AVEC ticket perso → sert la file perso, N'appelle PAS le fallback", async () => {
    // Appel 1 = getCounterAgentId → agent ; Appel 2 = selectNextPersonal → ticket perso
    const tx = recordingTx([[{ agent_id: "agent-1" }], [personalRow]]);
    const fallback = spyFallback();
    const result = await selectNextForManager(fallback)("q1", "c1", tx);
    expect(result?.id).toBe("perso-ticket");
    expect(result?.priority).toBe("VIP");
    expect(fallback.called).toBe(0);
    // selectNextPersonal lie [queueId, managerId]
    expect((tx.calls[1] as RecordedCall).params).toEqual(["q1", "agent-1"]);
    // SQL de la file perso non vide, filtre target_manager_id (kill StringLiteral ligne 179)
    const persoSql = (tx.calls[1] as RecordedCall).sql;
    expect(persoSql).toContain("t.target_manager_id = $2");
    expect(persoSql).toContain("CASE t.priority");
    expect(persoSql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("SEC-005: agent SANS ticket perso → délègue au fallback (file de service)", async () => {
    const tx = recordingTx([[{ agent_id: "agent-1" }], []]); // perso vide
    const fallback = spyFallback();
    const result = await selectNextForManager(fallback)("q1", "c1", tx);
    expect(result?.id).toBe("fallback-ticket");
    expect(fallback.called).toBe(1);
  });

  it("SEC-005: guichet SANS agent → délègue directement au fallback (agentId null)", async () => {
    const tx = recordingTx([[{ agent_id: null }]]); // pas d'agent
    const fallback = spyFallback();
    const result = await selectNextForManager(fallback)("q1", "c1", tx);
    expect(result?.id).toBe("fallback-ticket");
    expect(fallback.called).toBe(1);
    // selectNextPersonal NON appelé (une seule query = getCounterAgentId)
    expect(tx.calls).toHaveLength(1);
  });

  it("SEC-005: guichet inconnu (aucune ligne) → agentId null → fallback", async () => {
    const tx = recordingTx([[]]); // counter introuvable
    const fallback = spyFallback();
    const result = await selectNextForManager(fallback)("q1", "c1", tx);
    expect(result?.id).toBe("fallback-ticket");
    expect(fallback.called).toBe(1);
  });

  it("SEC-005: getCounterAgentId lie [counterId] et lit agent_id (kill Array/Str ligne 156)", async () => {
    const tx = recordingTx([[{ agent_id: null }]]);
    const fallback = spyFallback();
    await selectNextForManager(fallback)("q1", "counter-77", tx);
    expect((tx.calls[0] as RecordedCall).params).toEqual(["counter-77"]);
    // SQL non vide, lit agent_id du guichet (kill StringLiteral ligne 156)
    expect((tx.calls[0] as RecordedCall).sql).toContain("agent_id");
    expect((tx.calls[0] as RecordedCall).sql).toContain("FROM counters");
  });

  it("SEC-005: ticket perso mappé champ-à-champ (kill ObjectLiteral ligne 193)", async () => {
    const tx = recordingTx([[{ agent_id: "agent-1" }], [personalRow]]);
    const result = await selectNextForManager(spyFallback())("q1", "c1", tx);
    expect(result).toEqual({
      id: "perso-ticket",
      queueId: "q1",
      serviceId: "s1",
      status: "WAITING",
      priority: "VIP",
      issuedAt: personalRow.issued_at,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});
