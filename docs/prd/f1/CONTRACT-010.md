# CONTRACT-010 : Corrections lot F1 — durcissement sécurité du contrat + cohérence inter-YAML (issues panel Boucle 3)

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001..009 (DONE) · **Statut** : TODO
**Origine** : findings panel (`14-panel-f1-synthese.md`). Amendements de LA LOI AVANT tout consommateur (F2/F4 non démarrées) — non-breaking de fait ; re-validation Tech Lead flash sur le diff après DONE.

## Exigences (EARS)

### Sécurité (core.yaml, public.yaml, notifications.yaml, agents.yaml)
- `agencyId` doit être RETIRÉ de `CreateTicketRequest` et `TicketSyncItem` (dérivé du claim JWT) ; `GET /queues` conserve `agencyId` en query MAIS porte une `x-security-note` : « l'implémentation DOIT vérifier agencyId ∈ JWT.agencyIds, sinon 403 ».
- `POST /auth/logout` doit porter `security: []` (révocation possible avec token expiré).
- La convention doit distinguer « sans auth » de « JWT requis sans rôle minimal » : ajouter la valeur **`AUTHENTICATED`** à l'enum de `x-required-role` (ruleset spectral + `_dag.md` mis à jour par l'orchestrateur) ; corriger `GET /auth/me` et `POST /kiosks/:kioskId/heartbeat` (JWT borne) en `AUTHENTICATED`.
- `POST /notifications/devices` doit documenter 429 (rate-limit par IP, 10 req/min) ; `DELETE /notifications/devices/:deviceId` doit porter `x-required-role: AUTHENTICATED` + `x-ownership-required: true` (propriétaire ou BANK_ADMIN).
- `phone` de `AgentProfile` doit devenir `phoneMasked` (règle de masquage de CONTRACT-007) ; les champs téléphone d'ENTRÉE (`CreateTicketRequest.phoneNumber`, colonne CSV `phone`) doivent porter le pattern E.164 `^\+[1-9]\d{7,14}$` (CSV : ligne non conforme → `errors[]` code `INVALID_PHONE_FORMAT`).
- `deviceToken` ne doit PAS figurer dans la réponse 200 (idempotente) de `POST /notifications/devices` (201 uniquement).

### Cohérence inter-YAML
- `DELETE /agencies/:id` doit exister dans **core.yaml uniquement** (admin.yaml le retire), code 409 unique **`AGENCY_HAS_OPEN_TICKETS`** (WAITING|CALLED|SERVING).
- `PrinterStatus` doit être défini dans **core.yaml** (canonique : `OK | PAPER_LOW | ERROR | OFFLINE`) et référencé par public.yaml et reporting.yaml ($ref, zéro redéfinition).
- agents.yaml : corriger la regex `^[0-2][09]:...` → `^[0-2][0-9]:...` (DaySchedule.end) ; ajouter `additionalProperties: false` sur ses 10 schémas.
- notifications.yaml : `NotificationLogEntry.failureReason` → `$ref` vers `NotificationFailureReason` ; corriger l'exemple aberrant de `WebhookDeliveryPayload.failureReason` (date → `PROVIDER_UNREACHABLE`).
- public.yaml : propriété `commentaire` → `comment` (nommage anglais homogène).
- `src/index.ts` : `OPENAPI_PATHS` doit couvrir les 7 modules.
- ai.yaml : documenter la dualité `meta` (pagination) / `aiMeta` sur AnomaliesListResponse (description).
- **~50 exemples d'identifiants non-UUID** (`bank_01`, `agency_01`, `ticket_42`… — inventaire dans le finding ST2 du journal 14) doivent être remplacés par des UUID v4 valides et STABLES (fixes, pas aléatoires — déterminisme des bundles).
- ci.yml : ajouter un commentaire de traçabilité au service dind (pourquoi --privileged : Testcontainers) — seule modification hors packages/contracts, consignée.

### Après amendements
- `bundle` + `generate` relancés : déterminisme conservé, typecheck strict vert sur generated/, `generated/` re-commité synchrone.
- Les tests structurels existants (150) sont mis à jour là où le contrat change de forme (TDD : test d'abord pour chaque changement) ; Schemathesis fumée : **zéro warning de mismatch d'exemples** (les warnings uuid disparaissent).

## Critères d'acceptation
- [ ] `CONTRACT-010: agencyId absent de CreateTicketRequest et TicketSyncItem ; x-security-note sur /queues (tests)`
- [ ] `CONTRACT-010: logout security:[] ; AUTHENTICATED dans l'enum spectral et appliqué à /auth/me + heartbeat (tests)`
- [ ] `CONTRACT-010: devices — 429 documenté, ownership formalisé, deviceToken absent du 200 (tests)`
- [ ] `CONTRACT-010: phoneMasked agent + E.164 sur les entrées téléphone (tests)`
- [ ] `CONTRACT-010: DELETE /agencies unique dans core, code AGENCY_HAS_OPEN_TICKETS ; PrinterStatus canonique core (tests)`
- [ ] `CONTRACT-010: zéro identifiant d'exemple non-UUID sur champ format:uuid dans les 7 YAML (test d'inventaire)`
- [ ] `CONTRACT-010: fumée Schemathesis contre le mock core — zéro warning de mismatch (preuve)`
- [ ] `CONTRACT-010: spectral zéro erreur ; generate 2× zéro diff ; 150+ tests contracts verts`

## Hors scope
Smoke Schemathesis auth-aware (F3/RT-001) · retrait du service dind (consigné, décision infra ultérieure) · toute nouvelle ressource.
