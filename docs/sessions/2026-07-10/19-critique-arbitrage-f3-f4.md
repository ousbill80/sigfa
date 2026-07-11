# Session 2026-07-11 — Arbitrage des critiques · VAGUES F3+F4 (Boucle 1, itération 1)

**Verdicts** : completeness → GAPS (3 BLOCKER) · ambiguity → AMBIGUOUS (5 BLOCKER) · feasibility → INFEASIBLE (5 BLOCKER). Tous arbitrés ci-dessous — table de DÉCISIONS EXÉCUTOIRES (appliquées aux stories par amendement v2).

## Amendement de contrat groupé : CONTRACT-012 (story `docs/prd/f1/CONTRACT-012.md`)
- `sync:state` gagne `recentCalls[]{ticketNumber, displayNumber, counterLabel, calledAt}` (N=4 derniers CALLED) — reconstruction TV post-reconnexion.
- `alertManagerTypeSchema` gagne `KIOSK_SYSTEM_ERROR`.
- REJETÉS : « CONTRACT-012-REPORT-ALIASES » (les routes /reports/live|network|comex sont des INVENTIONS des drafts — les stories WEB s'alignent sur LA LOI : /reports/kpis?scope=, /reports/benchmark, /admin/network-overview) · « POST /kiosk/alert » (l'alerte sur sync skippé est émise CÔTÉ SERVEUR par API-005 — ajouté à API-005, KIOSK-006 corrigée).

## Décisions F3 (à appliquer dans les stories)
| Story | Décision |
|---|---|
| API-003 | TMT glissant = moyenne simple des service_time des DONE du service sur **60 min** (Abidjan), **≥5 observations**, sinon `sla_minutes` (NOT NULL en base), sinon défaut global 15 — dans `services/queue-estimation.ts`. **Position = PULL** (`rank() OVER (PARTITION BY queue_id ORDER BY priority DESC, issued_at)`) + **cache Redis TTL 10 s invalidé sur mutation de file** ; `queue:updated` ne porte que length+estimate. Interface stratégie : `type TicketSelector = (queueId, counterId, tx) => Promise<Ticket|null>` dans `services/queue-strategy.ts` — API-003 fournit `selectNextFifo`, API-004 `selectNextPriority` et change le défaut. |
| API-005 | + QUAND des lignes sont skipped à la sync, le SERVEUR émet `alert:manager` type KIOSK_SYSTEM_ERROR (une par batch, payload = compte+raisons). |
| API-006 | Wiring documenté : `const server = serve(honoApp)` (@hono/node-server) puis `new Server(server)` — critère : route HTTP et upgrade WS coexistent sur le même port ; handshake authentifié AVANT join. |
| API-007 | Anti-flap par **agentId** (Redis SET NX TTL 30 s, reconnexion → DEL). Balayages = **jobs BullMQ repeatable** (`inactive-agent-scan`, `sla-scan`) avec verrou distribué (worker concurrency=1) — critère : 2 instances → UNE alerte (test de course). Intervalle exporté `config/alerting.ts`, injectable env. |
| API-002 | Routes platform : connexion **`withPlatform`** ajoutée à @sigfa/database (couture consignée, périmètre étendu de la story, + test « route platform sous sigfa_app → échec permissions ») — jamais de SET bank_id vide. |
| API-001 | Confirmé : le bootstrap Hono/Pino/Redis/deps EST le périmètre d'API-001 (rejet du « API-000 » — déjà tracé, liste de deps explicitée dans la story). |
| API-010 | Fenêtre 24 h en **UTC strict** (`NOW() - closed_at > INTERVAL '24 hours'`). |
| API-011 | `KIOSK_HEARTBEAT_INTERVAL_S = 60` constante globale v1 ; SILENT = last_seen < NOW()-3 min. |

## Décisions F4 (à appliquer dans les stories)
| Story | Décision |
|---|---|
| WEB-002 | `/counters/{id}/call-next` PARTOUT (la route /call ciblée n'est pas dans l'UI agent). |
| WEB-003/004/005 | Routes alignées LA LOI : kpis?scope=agency (003), benchmark + network-overview (004), kpis?scope=network 3 KPIs (005). + WEB-003 : action inline MANAGER OPEN/PAUSED sur guichet (`PATCH /counters/:id`) — parcours P3 complet. |
| WEB-004 | SVG statique CI inscrit dans la story (Leaflet exclu). |
| WEB-001 & KIOSK-001 | Outillage inscrit : **MSW 2.x** (browser+node configurés) ; **Playwright `toHaveScreenshot`** (maxDiffPixelRatio 0.002), snapshots `apps/<app>/e2e/__snapshots__/{story}/{lang}.png`. KIOSK-001 : pattern Electron headless CI (xvfb+libgbm documentés) SINON critère replié « logique en Testing Library + snapshot Next hors Electron ; le run Electron réel = gate humain démo » — décision : REPLI adopté en F4 (Electron E2E complet = RT-003), consigné. |
| KIOSK-004/006 | Hook `useOfflineTicket()` déclaré stub en 004, implémenté en 006 ; DAG : 006 devient parallèle à 005 (dépend de 004). |
| KIOSK-006 | L'alerte sync-skipped est SERVEUR (API-005) — la borne affiche seulement l'état. |
| KIOSK-007 | Type `KIOSK_SYSTEM_ERROR` (dépend de CONTRACT-012) + extension : réseau coupé APRÈS 201 avant confirmation imprimante → numéro affiché 8 s + « photographiez votre numéro », kiosk:printer-error au retour si ERROR. |
| MOB-001 | Plan B documenté : (1) metro.config watchFolders+extraNodeModules ; (2) sinon symlinks postinstall ciblés ; (3) sinon hoisted GLOBAL avec gate orchestrateur (jamais silencieux). Critère CI réel. |
| MOB-002/004 | Frontière : MOB-002 = `enqueue()` dans `pending_tickets[]` MMKV ; MOB-004 = `flush()` FIFO + dédup + purge. |
| MOB-003 | 5 états CANONIQUES (loading skeleton + empty distincts) ; sockets : **mock WS local derrière flag** (tests d'événements), AUCUNE connexion réelle (RT-001) ; Live Activity : structure derrière `EXPO_PUBLIC_LIVE_ACTIVITY=false`, test = pas de crash flag off, activation EAS = story post-F4. |
| TV-001/002 | empty : assertion CSS `--display-tv ≥64px` (testable) ; reconstruction post-reconnexion via `sync:state.recentCalls` (CONTRACT-012). |
| _dag F4 / CLAUDE.md | **DESIGN-gate = gate d'ORCHESTRATEUR** : l'implémentation d'un écran gaté n'est dispatchée qu'APRÈS GO wireframe humain dans la session (mécanisme exécutoire = séquencement du dispatch, pas un label). Inscrit au CLAUDE.md §4. |

## Rejets (transparence)
API-000 bootstrap (déjà porté par API-001) · aliases /reports/* (inventions vs LA LOI) · POST /kiosk/alert (server-side) · k6 en critère F3 (SEC-004 le porte) · Percy/outillage visuel externe (Playwright natif suffit).
