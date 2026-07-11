# VAGUE F3 — API CŒUR · DAG

> agent-api implémente LE VRAI contrat (LA LOI, bundles `packages/contracts/generated/bundled/`). Schemathesis contre l'API réelle = juge de paix. Statuts : `TODO → … → DONE | BLOCKED`

**Révision** : v2 — arbitrage 19

```
CONTRACT-012 (prérequis) ─────────────────────────────────────────────► API-005 (emit KIOSK_SYSTEM_ERROR)
                                                                         ▲
F2 DONE ──► API-001 (auth) ──► API-002 (middleware tenant+withPlatform) ──► API-003 (cycle ticket)
                                        │                                     ├─► API-004 (moteur de file) ─► API-007 (agents+alertes)
                                        │                                     ├─► API-005 (sync offline) ─────┘
                                        │                                     ├─► API-006 (socket.io+lock)
                                        │                                     └─► API-010 (feedback)
                                        ├─► API-008 (CRUD admin+RBAC) ─► API-009 (templates+onboarding)
                                        └─► API-011 (rate limit+health+supervision)
```
**Exécution séquentielle** (un package `apps/api`, fichiers d'app partagés — leçon F0/F2). Ordre : 001→002→003→004→006→005→007→008→009→010→011.

**CONTRACT-012 prérequis** : `alertManagerTypeSchema` doit inclure `KIOSK_SYSTEM_ERROR` avant API-005 et API-007. Consommé côté F4 par KIOSK-007 et TV-002.

**Note withPlatform (API-002)** : connexion `withPlatform` ajoutée à `@sigfa/database` — couture consignée, périmètre étendu de la story ; jamais de SET bank_id vide.

## Conventions communes F3
- **Hono 4** dans `apps/api/src/` : `routes/` (un routeur par périmètre), `middleware/`, `services/` (logique), `realtime/` — kebab-case, fonctions ≤30 lignes, JSDoc.
- **LA LOI est exécutoire** : chaque handler valide entrée/sortie contre les schémas du contrat (zod depuis @sigfa/schemas + types generated) ; toute réponse d'erreur = `{ error: { code, message, details? } }` avec les codes EXACTS du YAML ; chaque story dont les routes changent AJOUTE sa cible Schemathesis (harness F0) contre l'API réelle démarrée sur Testcontainers — c'est le gate T4.
- **Tenant** : après API-002, TOUT accès DB passe par `withTenant` (connexion sigfa_app) — le middleware résout bank_id depuis le JWT, JAMAIS du payload. Routes platform (SUPER_ADMIN) : connexion migrateur dédiée, explicitement listées.
- **Redis 7 réel** (Testcontainers, harness F0) : sessions refresh (rotation), blocage login, clés d'idempotence (TTL 24 h, `IDEMPOTENCY_CONFLICT` si payload différent), verrous d'appel (SET NX PX), pub/sub Socket.io.
- **Événements** : contrat `packages/contracts/events/realtime.ts` — payload validé Zod À L'ÉMISSION (contrat 002), rooms `agency:{id}`.
- Tests d'intégration : Supertest/fetch contre l'app réelle + PG16 + Redis réels — jamais de mock des dépendances. Tests nommés `API-00x: ...`. Couverture ≥85 % nouveaux fichiers.
- `.env.example` : chaque story ajoute SES variables (JWT_SECRET, REDIS_URL…).
- Suites transverses enrichies : `sla-engine` (machine à états exhaustive dès API-003/004), `realtime-guarantees` (API-006), `tenant-isolation` (chaque route → test de scope).

| ID | Story | Dépend de | Statut |
|---|---|---|---|
| API-001 | Auth : login/refresh/logout/me, JWT 15min+refresh 7j rotation, bcrypt 12, blocage 5/15min | F2 | DONE |
| API-002 | Middleware tenant : JWT → withTenant sur chaque requête, x-required-role enforcé (rbac-matrix) | 001 | DONE |
| API-003 | Cycle de vie ticket : émission idempotente, call-next/call/serve/close/no-show/transfer/abandon | 002 | TODO |
| API-004 | Moteur de file : priorités 5 niveaux, routage compétence+langue, débordement, pause de file | 003 | TODO |
| API-005 | Sync offline : batch ≤100, idempotence local_uuid, résolution numéros | 003 | TODO |
| API-006 | Socket.io serveur conforme contrat + lock d'appel (2 agents → 1 gagnant) | 003 | TODO |
| API-007 | Agents : statuts+history, chrono, alertes (inactif, SLA, déconnexion→WAITING PRIORITY) | 004, 006 | TODO |
| API-008 | CRUD admin : banks/agencies/services/counters/queues/hours+fériés, RBAC 6 rôles, audit branché | 002 | TODO |
| API-009 | Templates & onboarding : clone-from, kiosk-access+session borne, import CSV agents, theming+purge-phone | 008 | TODO |
| API-010 | Feedback public par trackingId : fenêtres 422/409, agrégation NPS, anti-spam | 003 | TODO |
| API-011 | Rate limiting routes publiques, /health, heartbeat+kiosks/status, audit-logs lecture | 002 | TODO |

## Gate de sortie de vague
Schemathesis PASS sur les 7 modules contre l'API réelle · suites tenant-isolation par route PASS · sla-engine machine à états exhaustive PASS · realtime <500 ms local PASS · CI verte. Puis RT-001 (bascule mock→réel des clients F4).
