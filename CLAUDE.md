# SIGFA — CLAUDE.md (Constitution du projet)

> Chargé à chaque session. Toute règle ici est prioritaire sur les habitudes du modèle.
> Sources de vérité : `docs/SIGFA_PROMPT_v5.md` (produit) · `docs/SIGFA_METHODE_CONCEPTION_AGENTIQUE.md` (méthode) · `docs/SIGFA_DESIGN_SYSTEM.md` (design) · `docs/prd/` (stories exécutables).

---

## 1. Rôle du thread principal

**Le thread principal est l'ORCHESTRATEUR (Fable 5). Il planifie, dispatche, relit, vérifie les coutures. Il ne produit JAMAIS de diffs lui-même.**

Un hook bloque ses écritures sur `apps/` et `packages/` — ce n'est pas une suggestion.

## 2. Routage du travail

| Périmètre touché | Agent à dispatcher |
|---|---|
| `packages/contracts/` | `agent-contract` — toujours EN PREMIER (racine du DAG) |
| `packages/database/` | `agent-database` |
| `apps/api/` | `agent-api` |
| `apps/web/` | `agent-web` |
| `apps/kiosk/` | `agent-kiosk` |
| `apps/mobile/` | `agent-mobile` |
| Après tout lot de stories | Fan-out parallèle : `security-reviewer` + `test-coverage-checker` + `style-conformance` + `design-reviewer` |
| Rédaction/critique de PRD | Fan-out : `critic-completeness` + `critic-ambiguity` + `critic-feasibility` |

Tâche triviale (typo, renommage local) → agent unique en direct, pas d'orchestration.

## 3. Les 5 principes (rappel exécutable)

1. **PRD d'abord** : aucune implémentation sans story EARS DONE-able dans `docs/prd/`.
2. **API-First 100%** : la story CONTRACT du module est la racine du DAG. Frontends codent contre le mock généré. Aucun fetch vers une route absente du contrat.
3. **Test Total** : code + test + doc = un seul commit. TDD rouge→vert avec preuve (`red_run_output` obligatoire dans le contrat de sortie). Un hook rejette tout commit sans test.
4. **Un contexte par couche** : ne jamais donner à un agent les règles d'une autre couche.
5. **3 échecs = BLOCKED + escalade humaine.** Jamais de contournement des critères d'acceptation.

## 4. Gate de story (9 étapes, arrêt au premier FAIL)

1. lint + typecheck (zéro `any`, zéro `ts-ignore`)
2. Chaque fichier source du diff a son test dans le diff
3. Tests unitaires + composants du périmètre
4. Tests d'intégration (Testcontainers — vraie PostgreSQL/Redis)
5. Schemathesis si une route a changé
6. Suite `tenant-isolation` si table/route touchée
7. Suite `offline` si kiosk/mobile touché
8. Mapping critères EARS ↔ tests nommés (`STORY-xxx: ...`)
9. Ratchet de couverture : ≥85% nouveaux fichiers, jamais de baisse

## 5. Hors scope DÉFINITIF (ne jamais implémenter, ne jamais proposer)

Core Banking (CBS) · CRM bancaire · Mobile Money · USSD · Biométrie · Connecteur BCEAO.
SIGFA est 100% autonome et standalone.

## 6. Stack (source : SIGFA_PROMPT_v5.md §7)

Hono 4 + TypeScript strict · Drizzle + PostgreSQL 16 RLS (multi-tenant bridge : `bank_id` + policies) · Redis 7 + BullMQ · Socket.io · Next.js 15 + shadcn/ui + Tailwind 4 · Electron (kiosque) · Expo SDK 51 · Vitest/Supertest/Testcontainers/Schemathesis/Playwright/k6.

## 7. Conventions

kebab-case fichiers · PascalCase classes · camelCase fonctions · Conventional Commits · imports absolus depuis `src/` · variables d'env dans `.env` + `.env.example` · schémas Drizzle = vérité du modèle · schémas Zod partagés via `@sigfa/schemas` · OpenAPI = LA LOI des échanges client↔serveur.

## 8. Design (source : SIGFA_DESIGN_SYSTEM.md)

Tokens uniquement, jamais de valeur en dur · Kiosque : cibles ≥72px, texte ≥24px, contraste ≥7:1, une décision par écran · Theming banque = habillage, jamais structure · 4 langues (FR/Dioula/Baoulé/EN), icône+texte toujours appariés · 5 états par écran (nominal/loading/empty/error/offline).

## 9. Contrats de sortie des subagents

Tout subagent termine par un bloc JSON structuré (voir son fichier d'agent). L'orchestrateur REJETTE toute sortie sans JSON valide, et toute story d'implémentation sans `red_run_output`.

## 10. Journalisation

Chaque session écrit son plan de dispatch et ses rapports dans `docs/sessions/{date}/`. Chaque échec de classe récurrente génère une leçon dans `.claude/lessons/`.
