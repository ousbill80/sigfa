# VAGUE F1 — CONTRATS · DAG

> LA LOI avant tout code. F1 DONE (contrats validés Tech Lead + génération outillée) est le prérequis de F2, F3 et F4.
> Statuts : `TODO → IN_PROGRESS → REVIEW → DONE | BLOCKED`

```
INFRA-005 (DONE)
   └──► CONTRACT-001 (cœur : ressources + machine à états ticket)   ← racine, dispatch seul
            ├──► CONTRACT-002 (événements Socket.io)      ┐
            ├──► CONTRACT-003 (client public)             │
            ├──► CONTRACT-004 (agents & compétences)      │ parallélisables :
            ├──► CONTRACT-005 (admin & RBAC)              │ un fichier YAML/TS par story,
            ├──► CONTRACT-006 (reporting)                 │ $ref vers les schémas de 001
            └──► CONTRACT-007 (notifications)             ┘
                     CONTRACT-008 (IA) ── dépend de 001 + 006
            └──► CONTRACT-009 (génération outillée) ── dépend de 001..008 DONE
```

| ID | Story | Fichier(s) possédé(s) | Dépend de | Statut |
|---|---|---|---|---|
| CONTRACT-001 | Contrat cœur : tenants, auth, agences, services, guichets, files, tickets | `openapi/core.yaml` | INFRA-005 | DONE |
| CONTRACT-002 | Événements Socket.io temps réel | `events/realtime.ts` | 001 | DONE |
| CONTRACT-003 | Client public : émission multi-canal, suivi, feedback, sync borne | `openapi/public.yaml` | 001 | DONE |
| CONTRACT-004 | Agents & compétences | `openapi/agents.yaml` | 001 | DONE |
| CONTRACT-005 | Admin : RBAC, config, templates, onboarding | `openapi/admin.yaml` | 001 | DONE |
| CONTRACT-006 | Reporting : KPIs, rapports, exports | `openapi/reporting.yaml` | 001 | DONE |
| CONTRACT-007 | Notifications : SMS, WhatsApp, email, push | `openapi/notifications.yaml` | 001 | DONE |
| CONTRACT-008 | IA : prédictions, staffing, anomalies, NLP | `openapi/ai.yaml` | 001, 006 | DONE |
| CONTRACT-009 | Génération outillée : types TS + client typé + mock Prism + squelettes Schemathesis + **diff de contrat en CI (C4)** | `packages/contracts/generated/**`, scripts, job CI | 001–008 | DONE |

## Conventions communes du contrat (s'appliquent à TOUTES les stories F1 — ne pas répéter dans chaque story)
- **OpenAPI 3.1**, un fichier par périmètre sous `packages/contracts/openapi/`, servi sous `/api/v1`.
- Chaque endpoint : `summary`, `description`, tag, **les 9 codes de réponse** (2xx, 400, 401, 403, 404, 409, 422, 429, 500) avec schéma ; le schéma d'erreur est CELUI de `@sigfa/schemas` (`{ error: { code, message, details? } }`, code `^[A-Z][A-Z0-9_]*$`) référencé, jamais dupliqué.
- Chaque route documente : **scope tenant** (`platform` | `bank` | `agency` | `public`) et **claim JWT requis** (extension `x-tenant-scope`, `x-required-role`).
- Pagination : `?page=&limit=` (bornes de `@sigfa/schemas`) avec enveloppe `{ data, meta }`.
- Mutations critiques (†) : header `X-Idempotency-Key` obligatoire — **format** : string 1..255 caractères (UUID recommandé en description, non imposé), schéma unique dans `components/headers/IdempotencyKey` de core.yaml ; 400 `IDEMPOTENCY_KEY_REQUIRED` si absent, rejeu TTL 24 h (même clé → même réponse), 409 `IDEMPOTENCY_CONFLICT` si même clé + payload différent.
- Schémas réutilisables dans `components/schemas` ; les fichiers 002–008 référencent ceux de `core.yaml` (`$ref` inter-fichiers) — zéro duplication.
- Exemples requête/réponse sur chaque endpoint — les critères des stories 001–008 vérifient « exemples présents + valides (spectral) » ; le **smoke Prism global est le périmètre de CONTRACT-009b**, pas des stories individuelles.
- Lint : **spectral** zéro erreur (ruleset commité `packages/contracts/.spectral.yaml`, créé par 001) incluant les **règles custom** : `x-required-role` ∈ {SUPER_ADMIN, BANK_ADMIN, AGENCY_DIRECTOR, MANAGER, AGENT, AUDITOR, NONE}, `x-tenant-scope` ∈ {platform, bank, agency, public} — obligatoires sur chaque opération.
- **Outillage épinglé (aucun « ou équivalent »)** : `@redocly/cli@^1` (bundle des $ref inter-fichiers — étape 1 de toute génération), `openapi-typescript@^7` (types), `openapi-fetch@^0.12` (client typé runtime), `@stoplight/prism-cli@^5` (mock), `@stoplight/spectral-cli@^6` (lint), `oasdiff` via image Docker `tufin/oasdiff` (diff CI, base de comparaison : `origin/main`).
- **Schémas transverses possédés par core.yaml (001)** : `TicketStatus`, `Role`, `NotificationType`, `components/headers/IdempotencyKey` — les autres fichiers les référencent, jamais de redéfinition.
- **Fichier de couture inter-vagues** : `.github/workflows/ci.yml` (possédé par INFRA-007 côté F0) — CONTRACT-009c y AJOUTE le job de diff ; intégration séquentielle par l'orchestrateur.
- Événements Socket.io : contrat TypeScript + Zod dans `packages/contracts/events/` (nom, payload, émetteur, consommateurs, room).
- Rooms : `agency:{id}` (préfixe bank implicite par auth socket) — définies dans CONTRACT-002.

## Gate de sortie de vague (humain — Tech Lead)
Relecture des YAML (REST, nommage, idempotence, sécurité tenant) → validation = **le contrat devient LA LOI** → CONTRACT-009 génère types/client/mock/squelettes → F2, F3‖F4 débloquées.
