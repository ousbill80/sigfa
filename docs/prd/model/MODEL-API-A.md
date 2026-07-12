# MODEL-API-A : API — résolution operation→service + CRUD opérations + alignement fixtures

**Module** : MODÈLE (Phase A) · **Agent** : agent-api · **Dépend de** : CONTRACT-A (DONE), DB-A (DONE) · **Statut** : TODO

**Révision** : v2 — arbitrage `_arbitrage.md` (D1, D2, D4, D8). Conforme à LA LOI (CONTRACT-A) + schéma (DB-A `operations`, `tickets.operation_id`).

## Exigences (EARS)
- **Résolution à la création de ticket (D1)** : QUAND `operationId` est fourni → le serveur charge l'opération (active, scope agence), dérive `service_id = operation.service_id`, et pose `tickets.operation_id` + `tickets.service_id` (conservé NOT NULL). SI `serviceId` aussi fourni ET incohérent avec l'opération → **422 `SERVICE_OPERATION_MISMATCH`**. SI `operationId` absent → `serviceId` utilisé tel quel (comportement F2/F3 INCHANGÉ). Appliqué à `POST /tickets`, `POST /public/tickets`, et `POST /tickets/sync` (operationId optionnel par item). Opération inconnue/inactive/hors agence → 404 `OPERATION_NOT_FOUND` (opaque en public).
- **CRUD opérations (admin)** : `GET/POST /services/{serviceId}/operations`, `GET/PATCH/DELETE /operations/{id}` — via `withTenant`, RBAC aligné services (BANK_ADMIN ; AGENCY_DIRECTOR sur son agence), `additionalProperties:false` → 422, `insertAuditEntry` sur chaque mutation, `OPERATION_CODE_DUPLICATE` (409/422) sur code dupliqué par service.
- **Liste publique borne** : `GET /public/agencies/{agencyId}/operations?serviceId=` (role NONE) → opérations actives + **`slaMinutes` RÉSOLU** (`operation.sla_minutes ?? service.sla_minutes`).
- **SLA résolu dans l'estimation (D4)** : `queue-estimation`/position utilisent le SLA résolu (opération sinon service) comme fallback TMT (règle testée). `selectNextPriority` INCHANGÉ (priorité = enum porteur du ticket).
- **ALIGNEMENT des 19 fixtures DDL inline (couture DB-A)** : les 19 fichiers `apps/api` qui redéclarent `CREATE TABLE tickets (...)` inline gagnent la table `operations` + la colonne `tickets.operation_id` NULLABLE (liste fournie par DB-A) → les 502 tests api restent verts.

## Fixtures à aligner (fournies par MODEL-DB-A)
`admin-test-harness.ts`, `agents.test.ts`, `offline-resilience.test.ts`, `public-tickets-create.test.ts`, `public-tickets.test.ts`, `queue-engine.test.ts`, `schemathesis-agents.test.ts`, `schemathesis-public.test.ts`, `schemathesis-tickets.test.ts`, `tickets-sync.test.ts`, `tickets.test.ts`, `agent-disconnect.test.ts`, `agent-status.test.ts`, `alert-jobs.test.ts`, `alert-scheduler.test.ts`, `rt002-test-harness.ts`, `socket-bus.integration.test.ts`, `socket-server-disconnect.test.ts`, `socket-server.test.ts`.

## Critères d'acceptation
- [ ] `MODEL-API-A: operationId fourni → service_id dérivé + operation_id posé ; mismatch serviceId/operationId → 422 SERVICE_OPERATION_MISMATCH ; absent → serviceId tel quel (F2/F3 inchangé)`
- [ ] `MODEL-API-A: création publique/agent/sync avec operationId → ticket dans le bon service ; operation inconnue → 404 OPERATION_NOT_FOUND`
- [ ] `MODEL-API-A: CRUD opérations (RBAC + audit + additionalProperties 422 + OPERATION_CODE_DUPLICATE) — Schemathesis PASS`
- [ ] `MODEL-API-A: liste publique operations avec slaMinutes RÉSOLU ; SLA résolu utilisé dans l'estimation (test)`
- [ ] `MODEL-API-A: 19 fixtures DDL inline alignées (operations + operation_id) → 502+ tests api verts, zéro régression`
- [ ] `MODEL-API-A: tenant-isolation operations (cross-agence/bank → refus) ; gate sérialisé vert`

## Hors scope
UI (KIOSK-A/WEB-A) · conseillers (Phase B) · schéma DB (DB-A DONE) · contrat (CONTRACT-A DONE).
