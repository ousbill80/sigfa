# VAGUE F2 — DATA · DAG

> Le schéma Drizzle est la source de vérité du modèle (CLAUDE.md §7). Alignement strict sur LA LOI (contrats F1) : enums, colonnes et contraintes DOIVENT correspondre aux schémas OpenAPI.
> Statuts : `TODO → IN_PROGRESS → REVIEW → DONE | BLOCKED`

```
CONTRACT-001..010 (DONE) ──► CONTRACT-011 (DONE) 
   └──► DB-001 (schéma cœur) ──► DB-002 (RLS + tenant-isolation) ──► DB-003 (migrations+seed)
                └──► DB-004 (audit) ─► DB-005 (notifications) ─► DB-006 (reporting) ─► DB-008 (chiffrement+purge) ─► DB-007 (IA)
```

**⚠ EXÉCUTION STRICTEMENT SÉQUENTIELLE** (leçon F0 appliquée en amont) : toutes les stories partagent `packages/database/` — la numérotation séquentielle des migrations drizzle-kit, le barrel `schema/index.ts` et le `package.json` rendent tout dispatch parallèle générateur de conflits. Ordre : **001 → 002 → 003 → 004 → 005 → 006 → 008 → 007** (008 avant 007 : les tables IA stockent des agrégats qui dépendent de la politique de rétention). Un seul agent-database actif à la fois, directement sur main, gates entre chaque story.

| ID | Story | Dépend de | Statut |
|---|---|---|---|
| DB-001 | Schéma cœur Drizzle : Bank, Agency, Service, Queue, Counter, **Kiosk**, Ticket, User, AgencyUser + enums alignés LA LOI | F1 DONE | DONE |
| DB-002 | Policies RLS toutes tables + helper SQL `app.current_bank_id` + suite tenant-isolation initiale | DB-001 | DONE |
| DB-003 | Migrations initiales + seed : 8 services défaut avec SLA, rôles, jours fériés CI | DB-002 | DONE |
| DB-004 | Table audit_log immuable (rétention 24 mois) + triggers | DB-003 | DONE |
| DB-005 | Tables notifications : templates par banque, opt-in/consent, journal d'envoi, devices push | DB-004 | DONE |
| DB-006 | Tables reporting : agrégats journaliers matérialisés, index bank_id+date | DB-005 | DONE |
| DB-008 | Chiffrement AES-256 des téléphones au repos + purge auto 13 mois (droit à l'oubli) | DB-006 | DONE |
| DB-007 | Tables IA : prédictions, anomalies, recommandations, scores + rétention | DB-008 | DONE |
| DB-009 | Corrections panel : RLS banks, secrets paramétrés, down complet, découpages | DB-001..008 | DONE |

## Conventions communes F2 (ne pas répéter dans les stories)
- **Drizzle ORM + PostgreSQL 16**, schéma TypeScript dans `packages/database/src/schema/` (un fichier par domaine + barrel), migrations `drizzle-kit` mode strict dans `packages/database/migrations/`, policies dans `packages/database/src/rls/`, seed dans `packages/database/src/seed/`.
- CHAQUE table métier : `bank_id uuid NOT NULL` (+ `agency_id` si pertinent), index composites **bank_id en tête**, `created_at`/`updated_at` timestamptz, `deleted_at` (soft delete) sur les entités auditables.
- **Enums = celles de LA LOI**, à l'identique : `TicketStatus` (7), `AgentStatus` (5), `NotificationChannel`, `NotificationType`, `PrinterStatus` (4), `TicketChannel`, `TicketPriority` (5 — **introduite par CONTRACT-011**, prérequis de DB-001). Test d'alignement enum Drizzle ↔ YAML bundlé, avec **exception documentée `Role`** : Drizzle = LA LOI \ {NONE} (sous-ensemble strict, NONE/AUTHENTICATED = conventions de route) + assertion que NONE est absent de pg_enum.
- **Versions épinglées** : `drizzle-orm ^0.36`, `drizzle-kit ^0.27` (dialect PG16, mode strict).
- `phone_encrypted` = `text` partout (format DB-008 `v1:iv:tag:ct`), accompagné de `phone_hash text` — types définitifs dès création.
- **Tests d'intégration Testcontainers** (PG16 réelle, harness `@sigfa/testing`) dans le même commit — JAMAIS de mock (T5). Chaque nouvelle table ajoute ses cas dans `packages/testing/src/tenant-isolation/` (périmètre étendu consigné, T6).
- TDD rouge→vert avec preuves ; tests nommés `DB-00x: ...` (T3).
- Ce qui reste côté API (hors F2) : stockage des clés d'idempotence (Redis, API-002/003), sessions/refresh tokens (Redis), verrous d'appel (Redis).

## Gate de sortie de vague
Migrations up/down propres sur PG16 vierge · suite tenant-isolation 100% PASS sur TOUTES les tables · seed idempotent · enums alignées LA LOI (test) · couverture ≥85% nouveaux fichiers · CI verte.
