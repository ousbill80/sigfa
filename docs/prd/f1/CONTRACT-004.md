# CONTRACT-004 : Contrat agents & compétences — profils, statuts, affectations, transferts

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/agents.yaml` ($ref vers core.yaml)

## Exigences (EARS)

- Le contrat doit définir le **profil agent** : `GET/PATCH /agents/:id` — services traitables (multi-sélection, ids du catalogue), langues parlées (enum `FR | DIOULA | BAOULE | EN`), agences d'affectation, horaires de travail.
- Le contrat doit définir le **statut temps réel** : `POST /agents/:id/status` avec machine à états `AVAILABLE → SERVING → PAUSED → ABSENT → OFFLINE` ; les transitions et leurs déclencheurs sont documentés ; SI la transition est illégale (ex. SERVING → ABSENT avec ticket ouvert sans transfert), ALORS 409 avec code dédié.
- Le contrat doit définir les **stats agent** : `GET /agents/:id/stats?period=` → tickets traités, TMT moyen du jour, ticket en cours (numéro + durée) — schémas réutilisés par le reporting (CONTRACT-006 les référencera).
- Le contrat doit définir l'**import CSV** : `POST /agents/import` (multipart, champ `file`) — colonnes obligatoires `email,firstName,lastName,role`, optionnelles `agencyCode,languages,phone`, séparateur virgule, UTF-8 sans BOM, **max 500 lignes** (422 `IMPORT_TOO_LARGE` au-delà) ; réponse `{ created, skipped, errors: [{ line, field, code, message }] }` ; exemple CSV dans le contrat.
- Chaque route documente scope (`bank` ou `agency`) + rôle minimal (gestion des agents = AGENCY_DIRECTOR+, consultation stats = l'agent lui-même ou MANAGER+ — encodé en `x-required-role` avec la règle « self »).
- Le lien avec le routage de file (compétence + langue, API-004) est documenté en description — le contrat expose les données, la logique est hors contrat.

## Critères d'acceptation

- [ ] `CONTRACT-004: spectral zéro erreur ; $ref core résolus (test bundle)`
- [ ] `CONTRACT-004: 9 codes + x-tenant-scope + x-required-role sur chaque route (test)`
- [ ] `CONTRACT-004: machine à états statut agent encodée avec 409 dédié (test)`
- [ ] `CONTRACT-004: import CSV — colonnes fixées + max 500 lignes + rapport { line, field, code, message } (test)`
- [ ] `CONTRACT-004: exemples présents + valides (spectral) — smoke Prism délégué à CONTRACT-009b`

## Hors scope
Implémentation statuts/alertes (API-007) · routage intelligent (API-004) · écrans (WEB-002/003) · onboarding complet agence (CONTRACT-005).
