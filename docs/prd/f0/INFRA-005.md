# INFRA-005 : Packages @sigfa/schemas, @sigfa/factories, @sigfa/testing — squelettes des 5 suites critiques

**Module** : F0 — Fondations · **Agent** : agent-database (périmètre étendu pour cette story à `packages/{schemas,factories,testing}` — exception consignée au plan de dispatch, aucune autre story de la vague ne touche ces fichiers, le hook d'écriture l'autorise pour cette story uniquement) · **Dépend de** : INFRA-001 · **Statut** : DONE (2026-07-11 — zéro retry ; 30 tests, PG16+Redis7 réels via Testcontainers, 5 harness livrés)
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)

## Exigences (EARS)

### @sigfa/schemas — primitifs partagés
- Le système doit fournir les schémas Zod primitifs, chacun exporté avec son type inféré (`z.infer`), **jamais** de type TypeScript dupliqué à la main :
  - `uuidSchema` ;
  - `paginationMetaSchema` : `page` int ≥1, `limit` int 1–100 (défaut 20), `total` int ≥0 — enveloppe `{ data, meta }` ;
  - `errorSchema` : `{ error: { code, message, details? } }` avec `code` conforme à `/^[A-Z][A-Z0-9_]*$/`, `message` string non vide, `details` `z.record(z.unknown()).optional()`.
- Les schémas **métier** (Ticket, Bank…) ne sont PAS créés ici (dérivés du contrat F1 et alignés Drizzle en F2).

### @sigfa/factories — T10
- Le système doit fournir `createFactory(schema)` : QUAND une factory est invoquée, elle produit une fixture **valide au sens du schéma Zod source** (`parse` réussit), avec surcharges typées (champ inexistant = erreur de compilation).
- Génération par **générateur maison seedé** (PRNG mulberry32, graine `number` optionnelle — même graine → même fixture) couvrant les primitives Zod utilisées (string/uuid/number/int/boolean/object/array/optional/enum) — zéro dépendance faker.
- Les tests de validité sont **property-based avec fast-check** (`fc.assert`, `numRuns: 100`), devDependency du package.

### @sigfa/testing — les 5 suites critiques (squelettes outillés)
- Chaque suite (`tenant-isolation/`, `offline-resilience/`, `realtime-guarantees/`, `sla-engine/`, `contract/`) doit avoir : un `README.md` décrivant ce qu'elle garantit (règles T4–T7), un harness importable, et ≥1 test exécutable prouvant le harness. Contenu minimal par harness :
  - **tenant-isolation** : helpers Testcontainers démarrant une **PostgreSQL 16** éphémère réelle (connexion vérifiée par `SELECT 1`) et un **Redis 7** éphémère réel (vérifié par `PING → PONG`) — jamais de mock (T5) ;
  - **realtime-guarantees** : serveur Socket.io éphémère + client de test + helper de mesure de latence événement→réception (le test du harness mesure un aller simple local) ;
  - **sla-engine** : horloge contrôlable (fake timers Vitest) + builder de timeline de ticket (`issuedAt → calledAt → servedAt → closedAt`) pour les futurs calculs TMA/TMT ;
  - **offline-resilience** : simulateur réseau on/off injectable + helper de rejeu de sync (structure d'appels enregistrée pour vérifier l'idempotence) ;
  - **contract** : script `run-schemathesis.sh` invoquant Schemathesis via son **image Docker officielle** (Docker déjà prérequis du projet), paramétré par chemin de YAML. SI aucun contrat n'existe (cas F0), ALORS sortie code 0 + message `SKIP: aucun contrat OpenAPI — voir CONTRACT-009` (jamais de faux vert) ; SI Docker est absent, ALORS échec propre avec message explicite.
- La story doit suivre le **micro-cycle TDD** : tests d'abord (rouge), implémentation (vert), preuves `red_run_output` / `green_run_output` dans le contrat de sortie JSON.

## Critères d'acceptation

- [ ] `INFRA-005: pour chaque schéma primitif, fixture de factory → parse réussit (fast-check, numRuns ≥100)`
- [ ] `INFRA-005: surcharge d'un champ inexistant → erreur TypeScript (test type-level, expect-type)`
- [ ] `INFRA-005: même graine → fixtures identiques ; graines différentes → fixtures différentes`
- [ ] `INFRA-005: harness Testcontainers — PostgreSQL 16 répond à SELECT 1 ET Redis 7 répond PONG (tests d'intégration réels)`
- [ ] `INFRA-005: harness realtime — événement Socket.io local reçu, latence mesurée et retournée par le helper`
- [ ] `INFRA-005: harness sla-engine — timeline construite sous fake timers, durées exactes au ms`
- [ ] `INFRA-005: harness offline — simulateur coupe/rétablit, le journal d'appels permet d'asserter un double-rejeu`
- [ ] `INFRA-005: run-schemathesis.sh sans YAML → exit 0 + message SKIP référençant CONTRACT-009 ; sans Docker → échec propre`
- [ ] `INFRA-005: les 5 suites ont README + harness + ≥1 test ; pnpm test vert sur @sigfa/testing`
- [ ] `INFRA-005: typecheck strict vert sur les 3 packages — zéro any, zéro ts-ignore`
- [ ] `INFRA-005: tous les types exportés proviennent de z.infer (revue : zéro duplication manuelle)`

## Hors scope de cette story

- Schémas Zod **métier** — F1 (CONTRACT-009) et F2
- Cas réels tenant-isolation (données banque A/B, injection bank_id) — DB-002
- Cas réels offline, realtime, sla-engine — remplis par F3/F4/F5
- Exécution Schemathesis réelle contre un contrat — CONTRACT-009
- `packages/database` (DB-001) et `packages/ui` (F4)
- Toute logique métier (calculs TMA/TMT, priorités) — sla-engine n'a ici que son harness
