# Session 2026-07-11 — Arbitrage des critiques · VAGUE F2 (Boucle 1, itération 1)

**Verdicts** : completeness → GAPS (7 BLOCKER, 6 MAJOR, 3 MINOR) · ambiguity → AMBIGUOUS (4 BLOCKER, 6 MAJOR, 3 MINOR) · feasibility → INFEASIBLE (2 BLOCKER, 5 MAJOR, 3 MINOR). Tous résolus par amendements v2 + **1 amendement de LA LOI requis (CONTRACT-011)**.

## Découverte structurante : LA LOI contredit le produit
`priority: boolean` dans core/public.yaml ≠ v5 §MODULE 1 (5 niveaux Standard<Prioritaire<VIP<PMR<Senior, cœur du moteur de file API-004). Arbitrage : **on amende le contrat** (CONTRACT-011 : enum `TicketPriority` + `Service.code` manquant + exemples) — fenêtre pré-consommateurs, validé au GO F2. Même story : `Service.code` (OC/OA/…) absent du contrat alors que le seed et l'affichage en dépendent ; `display_number` exemples alignés format `{code}-{NNN}`.

## Décisions d'arbitrage principales (tout le reste : intégré tel que suggéré)

| Sujet | Décision |
|---|---|
| Tables manquantes (7 BLOCKER completeness) | **INTÉGRÉ DB-001 v2** : `user_services`, `users.languages text[]`, `users.work_schedule jsonb`, `users.failed_login_attempts+locked_until`, `ticket_transfers`, `counter_services`, `agent_status_history`, colonnes session kiosque, theme structuré (`theme jsonb` UNIQUE colonne alignée BankTheme — tranche l'ambiguïté colors/theme), thresholds sur `banks` (3 colonnes bornées CHECK), `weekly_schedule` + table `agency_exceptional_closures`, `agencies.is_template` |
| `phone_hash` absent de tickets/users (BLOCKER feasibility — purgePhone impossible) | **INTÉGRÉ** DB-001 : `phone_hash` partout où `phone_encrypted` existe, index `(bank_id, phone_hash)` |
| Login email sans bankId (contrat) | **ARBITRÉ** : unicité email **GLOBALE en v1** (contrainte unique simple, testable) — le multi-banque même email viendra par slug/sous-domaine (story future consignée) |
| `issued_day` | **ARBITRÉ** : colonne générée `GENERATED ALWAYS AS ((issued_at AT TIME ZONE 'Africa/Abidjan')::date) STORED` + test 23h59 Abidjan |
| `display_number` | **ARBITRÉ** : `{code_service}-{number:03d}` (ex. OC-047), composé par l'API, exemples contrat alignés par CONTRACT-011 |
| Rôles PG vs RLS FORCE (MAJOR feasibility) | **INTÉGRÉ DB-002 v2** : double rôle (migrateur owner / applicatif non-owner sans BYPASSRLS), `src/rls/roles.sql`, harness Testcontainers étendu à 2 connectionStrings (périmètre testing consigné) |
| Test d'alignement Role 6≠7 | **INTÉGRÉ** : exception documentée — Drizzle Role = LA LOI \ {NONE} ; test asserte aussi absence de NONE dans pg_enum |
| `services.priority` vs `order` | **INTÉGRÉ** : suppression, `display_order` aligné sur `order` du contrat ; `code` ajouté à LA LOI (CONTRACT-011) |
| DB-006 unicité coalesce | **INTÉGRÉ** : 2 index uniques partiels (WHERE service_id IS NULL / IS NOT NULL), syntaxe Drizzle citée |
| DB-006 occupation | **INTÉGRÉ** : `agent_status_history` (DB-001) source de `agent_active_seconds` |
| hashPhone normalisation | **INTÉGRÉ DB-008** : normalisation centralisée (strip espaces/tirets, validation E.164, throw sinon) |
| `phone_encrypted` bytea vs text | **ARBITRÉ** : `text` (format `v1:iv:tag:ct` hex) fixé DÈS la création (DB-001/005), DB-008 n'altère pas |
| credentials_hash kiosque | **ARBITRÉ** : bcrypt cost 12 (cohérence auth) |
| current_ticket_number | **INTÉGRÉ** : CHECK ≥0 DEFAULT 0, pattern lock-then-increment documenté + test de concurrence (2 insertions simultanées → numéros distincts) |
| Liste de test notifications | **INTÉGRÉ DB-005** : table `notification_test_recipients` |
| Fériés mobiles >2027 | **INTÉGRÉ DB-003** : `is_approximate`, sources.md, warning si année courante > max(year), story d'exploitation consignée |
| public_holidays vs RLS/écriture | **INTÉGRÉ DB-003** : GRANT SELECT only au rôle applicatif + test |
| Audit : actor_email, occurred_at↔timestamp, action varchar(500), exclusion par pattern `_encrypted|_hash|_cipher`, PAS de trigger sur tickets (verrouillé par test) | **INTÉGRÉ DB-004** |
| Fixture déterministe reporting | **INTÉGRÉ DB-006** : `src/seed/fixtures/reporting-fixture.ts` avec valeurs attendues fixées |
| Insertions IA bank_id explicite | **INTÉGRÉ DB-007** : critère test 2 tenants |
| Versions | **INTÉGRÉ _dag** : `drizzle-orm ^0.36`, `drizzle-kit ^0.27` épinglés |
| rbac-matrix 6 rôles exacts (hors AUTHENTICATED/NONE) | **INTÉGRÉ DB-003** |

## Rejets (transparence)
- « DB-001 : critère routing query agents éligibles » (completeness) → reformulé : DB-001 fournit tables+index ; la REQUÊTE de routage est API-004 — le critère devient « les jointures nécessaires au routage sont réalisables (test de jointure simple) », pas un test du moteur.
- Sessions kiosque : proposition de table dédiée réduite à 3 colonnes sur `kiosks` (révocation auditée) + Redis pour le token — état minimal suffisant, table dédiée = surconception.

## État : v2 amendées, CONTRACT-011 rédigée. **GATE HUMAIN (PO)** : GO sur les 8 stories v2 + l'amendement CONTRACT-011 avant tout dispatch.
