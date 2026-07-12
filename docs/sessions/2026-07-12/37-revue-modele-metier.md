# Session 2026-07-12 — Revue croisée du modèle métier (Services · Opérations · Conseillers)

Revue adversariale (lecture seule) du chantier « modèle métier » livré COMMITÉ par le terminal parallèle (jusqu'à `e78678c`), à la demande du PO. Fan-out : sécurité + cohérence/intégrité + couverture, ciblé sur les couches STABLES `packages/database`, `packages/contracts`, `apps/api` (kiosk/web ignorés car working tree non commité en cours). Référence : `docs/prd/model/_arbitrage.md` (10 décisions).

## Verdict global : chantier SAIN et fidèle à l'arbitrage
Les 3 relecteurs convergent : implémentation de haute qualité. Aucun BLOCKER, aucune fuite tenant, aucune auth contournable. **1 finding MAJOR + 2 MINOR**, tous ci-dessous.

### Décisions d'arbitrage respectées (preuves relevées)
- **D1 additif non-breaking** : `tickets.service_id` conservé NOT NULL, `operation_id` ajouté NULLABLE ; contrat `serviceId` reste required, `operationId` optionnel ; `resolveOperation` dérive `service_id` et lève **422 `SERVICE_OPERATION_MISMATCH`** sur incohérence (`tickets.ts:383-406`). oasdiff `--fail-on ERR` vert.
- **D2 file PAR SERVICE** : `queues.service_id`/`tickets.queue_id` NOT NULL, l'opération ne crée pas de file, `resolveServiceQueue` via `operations.service_id`, invariant `(queue_id, number, issued_day)` + `{service.code}-NNN` intacts.
- **D3 migration additive idempotente** : migration 0009 crée `operations` + 1 opération « défaut » par service (garde `WHERE NOT EXISTS`), up+down testés, seed enrichi.
- **D4 SLA hérité, zéro priorité** : `COALESCE(operation.sla, service.sla)`, aucune colonne priorité sur services/operations, `selectNextPriority` inchangé.
- **D5 liste conseillers zéro PII** : DTO strict `{id, displayName, photoUrl?}` (SELECT en liste blanche), filtre `is_relationship_manager AND is_active AND deleted_at IS NULL`.
- **D6 file conseiller priorité absolue** : `target_manager_id` NULLABLE FK, `selectNextForManager` TicketSelector injectable, file perso d'abord puis service — **bornée** (`target_manager_id = agentId` du guichet, scope banque, pas de cross-agency, `FOR UPDATE SKIP LOCKED`).
- **D8 RLS** : `operations` ENABLE+FORCE + policy `tenant_isolation` + GRANT `sigfa_app` (migration 0009) ; nouvelles colonnes users/tickets héritent des policies. Suite `tenant-isolation` couvre.
- **D10 codes** : `operations.code` regex `^[A-Z0-9]{2,6}$` + UNIQUE `(service_id, code)`, `displayNumber` garde le préfixe service.

### `target_manager_id` — injection tenant IMPOSSIBLE (bien couvert)
`resolveTargetManager` (agent), son homologue sync, et le chemin public valident tous : `is_relationship_manager=true`, `is_active AND deleted_at IS NULL`, **même agence ET même banque** que le ticket. Un client ne peut cibler ni admin, ni agent d'une autre agence/banque. Prouvé sur les 3 chemins de création.

## Findings à remonter au terminal parallèle

### MAJOR — Routes publiques conseillers/opérations SANS rate-limit (anti-énumération D5 non appliquée)
`GET /public/agencies/{id}/relationship-managers` (`apps/api/src/routes/public-tickets.ts:152`) et `GET /public/agencies/{id}/operations` (`:203`) n'ont **aucun rate-limit** : `GLOBAL_RATE_LIMITS` (`apps/api/src/config/rate-limits.ts:39-46`) ne couvre que `/public/tickets`, et aucun `checkRateLimit` inline. La **liste nominative publique de conseillers** devient une surface d'énumération/scraping non bornée, alors que D5 (`_arbitrage.md:15`) et MODEL-API-B exigent l'anti-énumération. Le commentaire `public-tickets.ts:256-257` invoque à tort une borne 60/min qui ne s'applique pas à ce préfixe.
- **Fix** : ajouter `{ path: "/public/agencies", name: "public-agencies", limit: 60, windowSeconds: 60 }` à `GLOBAL_RATE_LIMITS` (le montage `/*` couvre les deux sous-routes), ou `checkRateLimit` IP inline en tête des deux handlers. + un test.

### MINOR — `relationship-managers` absente de Schemathesis
Le critère MODEL-API-B « Schemathesis (relationship-managers + agents) PASS » n'est que partiellement honoré : `agents` et `operations` sont fuzzés, mais `GET /public/agencies/{id}/relationship-managers` n'est dans aucun `--include-path-regex` (`schemathesis-public.test.ts`). Route testée fonctionnellement (zéro-PII, 400 uuid) et au contrat, mais pas en conformité OpenAPI fuzzée. Impact faible (lecture seule, DTO `additionalProperties:false`). **Fix** : ajouter `^/public/agencies/[^/]+/relationship-managers` au run Schemathesis public.

### MINOR — Idempotence backfill fragile à un renommage ultérieur du code défaut
La garde du backfill 0009 matche sur `(service_id, code = service.code)`. Si un admin renomme le code de l'opération « défaut » APRÈS migration puis qu'on rejoue 0009, une 2ᵉ opération défaut serait insérée (`UNIQUE(service_id, code)` ne bloque que les doublons de même code). Cas théorique (migrations non rejouées sur base vivante mutée). **Fix optionnel** : garder sur l'existence d'AU MOINS une opération pour le service (`WHERE NOT EXISTS (SELECT 1 FROM operations o WHERE o.service_id = s.id)`).

## Suite proposée
Le finding MAJOR (rate-limit) touche `apps/api/src/config/rate-limits.ts` + un handler public — **`apps/api` est actuellement propre** (le working tree du parallèle est sur kiosk/web), donc le fix est isolable. Décision de coordination à prendre (cf. thread orchestrateur) : soit l'orchestrateur le corrige en worktree isolé, soit on le remonte au parallèle pour qu'il l'intègre à son chantier. Les 2 MINOR peuvent être groupés avec.
