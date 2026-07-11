# Session 2026-07-11 — Boucle 3 · Synthèse du panel adversarial F1 (contrats)

**Verdicts** : security-reviewer → FINDINGS (7 MAJOR, 6 MINOR) · test-coverage-checker → FINDINGS (3 MINOR, zéro critère non couvert, T1/T3 conformes) · style-conformance → FINDINGS (1 MAJOR, ~13 MINOR). **Aucun CRITICAL → pas de rollback.** Amendements = corrections de LA LOI **avant tout consommateur** (F2/F4 pas encore démarrées → non-breaking de fait, fenêtre idéale).

## Arbitrage (findings → CONTRACT-010, sauf mention)

| # | Sév. | Finding | Décision |
|---|---|---|---|
| S1/S2 | MAJOR | `agencyId` client-contrôlable dans CreateTicketRequest et TicketSyncItem (injection cross-agence) | **INTÉGRÉ** — retirer du payload, dérivé du JWT ; x-security-note |
| S3 | MAJOR | `/auth/logout` sans `security: []` (déconnexion impossible token expiré) | **INTÉGRÉ** |
| S4 | MAJOR | `x-required-role: NONE` sur `/auth/me` (et heartbeat) alors que JWT requis — convention trompeuse | **INTÉGRÉ** — nouvelle valeur conventionnelle `AUTHENTICATED` ajoutée à l'enum spectral + corrections |
| S5/S6 | MAJOR | `/notifications/devices` : POST sans 429 contractualisé, DELETE sans contrôle de propriété formalisé | **INTÉGRÉ** — 429 + `x-ownership-required` |
| S7 | MAJOR | `GET /queues?agencyId=` sans contrainte agencyId ∈ JWT | **INTÉGRÉ** — x-security-note |
| S8–S13 | MINOR | phone agent en clair, E.164 absent (2×), deviceToken renvoyé sur 200, heartbeat prose, dind --privileged | **INTÉGRÉS** sauf dind : **consigné** (utile Testcontainers ; traçabilité ajoutée en commentaire ci.yml par 010) |
| ST1 | MAJOR | `DELETE /agencies/{id}` défini DANS LES DEUX fichiers (core.yaml ET admin.yaml) avec deux codes 409 différents (`AGENCY_HAS_ACTIVE_TICKETS` vs `AGENCY_HAS_OPEN_TICKETS`) — conflit de propriété | **INTÉGRÉ** — source unique core.yaml, code `AGENCY_HAS_OPEN_TICKETS` (conforme PRD), admin.yaml le retire |
| ST2 | MINOR | ~50 identifiants d'exemples non-UUID sur champs format:uuid (7 fichiers) — cause des warnings Schemathesis | **INTÉGRÉ** — remplacement systématique |
| ST3–ST10 | MINOR | PrinterStatus dupliqué avec enums divergentes (public vs reporting) → canonique dans core ; regex `[09]` coquille ; additionalProperties manquants (agents.yaml) ; failureReason dupliqué + exemple aberrant (date au lieu de raison) ; `commentaire` → `comment` ; OPENAPI_PATHS incomplet ; meta/aiMeta documenté | **TOUS INTÉGRÉS** |
| C1/C2 | MINOR | Textes PRD périmés (crit. 4 de 001 : IdempotencyKeyParam ; « 8 » → 7 modules dans 009) | **INTÉGRÉ** — corrigé par l'orchestrateur (docs) |
| C3 | MINOR | Warnings Schemathesis (auth 401/403 sur mock, exemples non-uuid) | **INTÉGRÉ via ST2** + smoke auth-aware différé (F3/RT) |

## Incident CI parallèle (hors panel)
`host.docker.internal` insoluble sur runner Linux → 3e occurrence de la leçon « environnement CI ≠ poste » (fix `--add-host=host-gateway`, leçon enrichie).

## Portage
**CONTRACT-010** (`docs/prd/f1/CONTRACT-010.md`) — agent-contract, direct. Après DONE : re-génération (bundle/generate/tests) + re-validation Tech Lead FLASH sur le diff (amendements de LA LOI, même non-breaking, restent visibles au PO).
