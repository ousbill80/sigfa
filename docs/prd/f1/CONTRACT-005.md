# CONTRACT-005 : Contrat admin — RBAC, config, templates, onboarding, audit trail, droit à l'oubli

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/admin.yaml` ($ref vers core.yaml)
**Révision** : v2 — amendée après critique (Boucle 1, itération 1 — ajouts BLOCKER : audit trail, droit à l'oubli)

## Exigences (EARS)

- Le contrat doit référencer le schéma `Role` de core.yaml (jamais de redéfinition) et documenter la hiérarchie RBAC en description.
- **Theming banque** : `GET/PATCH /banks/:id/theme` — logo via **URL signée R2 en 2 étapes** (`GET /banks/:id/theme/logo-upload-url` → `{ presignedUrl, expiresIn: 300 }` puis PUT client) ; formats `image/png`, `image/svg+xml`, `image/jpeg`, taille max 2 Mo, dimensions min 200×200 px ; couleurs : réponse avec `appliedColors` (contraste auto-corrigé ≥4.5:1) distinct de `requestedColors` ; `welcomeMessages` : `{ fr: requis, dioula/baoule/en: optionnels }`, texte brut, max 200 caractères chacun.
- **Config agence** : `GET/PATCH /agencies/:id/hours` (horaires/jour + fériés CI pré-chargés + fermetures exceptionnelles) ; `GET/PATCH /banks/:id/sms-templates` (variables autorisées `{{number}}`, `{{position}}`, `{{estimate}}` — 422 `UNKNOWN_TEMPLATE_VARIABLE` ; types de messages = enum `NotificationType` **référencée depuis core.yaml**) ; `GET/PATCH /banks/:id/thresholds` : `{ queueCriticalThreshold: int 1–500 (tickets), agentInactivityMinutes: int 1–60, noShowTimeoutMinutes: int 1–30 (défaut 3) }`.
- **Audit trail (BLOCKER intégré)** : `GET /audit-logs?entityType=&entityId=&actorId=&from=&to=` — SUPER_ADMIN | AUDITOR uniquement, pagination, schéma `AuditEntry` `{ actor, action, entityType, entityId, timestamp, ip, diff }` ; lecture seule, aucune mutation contractualisée (immuabilité DB-004).
- **Droit à l'oubli UEMOA (BLOCKER intégré)** : `POST /data/purge-phone` † `{ phone }` (BANK_ADMIN) → `{ purged: boolean, affectedTickets }` — idempotent (2e appel → `purged: false`) ; `GET /data/retention-policy` → politique de rétention (13 mois configurable, DB-008).
- **Onboarding** : `POST /agencies/:id/clone-from/:templateId` (config uniquement, jamais les données), `POST /agencies/:id/kiosk-access` (credentials borne + QR d'installation) — réponses typées.
- SI un PATCH de config contient un champ hors schéma, ALORS 422 (`additionalProperties: false`).
- `DELETE /agencies/:id` (précisé ici) : soft delete, 409 `AGENCY_HAS_OPEN_TICKETS` si tickets ouverts.

## Critères d'acceptation

- [ ] `CONTRACT-005: spectral zéro erreur ; $ref core résolus (test bundle redocly)`
- [ ] `CONTRACT-005: 9 codes + scope + rôle partout ; Role référencé depuis core (test)`
- [ ] `CONTRACT-005: theme — appliedColors vs requestedColors + upload R2 2 étapes + contraintes logo (test)`
- [ ] `CONTRACT-005: thresholds — bornes et défauts encodés dans le schéma (test)`
- [ ] `CONTRACT-005: audit-logs — AUDITOR-only, pagination, AuditEntry typé (test)`
- [ ] `CONTRACT-005: purge-phone idempotent documenté + retention-policy (test)`
- [ ] `CONTRACT-005: DELETE /agencies/:id → 409 AGENCY_HAS_OPEN_TICKETS documenté (test)`
- [ ] `CONTRACT-005: sms-templates — 422 UNKNOWN_TEMPLATE_VARIABLE + NotificationType $ref core (test)`
- [ ] `CONTRACT-005: exemples présents + valides (spectral) — smoke Prism délégué à CONTRACT-009b`

## Hors scope
Implémentation (API-008/009, ADM-001/002, DB-004/008, SEC-001) · UI (WEB-006) · calcul réel de contraste (ADM-001) · `/health` et `/kiosks/status` (CONTRACT-006) · heartbeat borne (CONTRACT-003).
