# MÉTHODE DE CONCEPTION AGENTIQUE — SIGFA
## Orchestration Fable 5 + Exécution Sonnet · API-First 100% · Test Total · Boucles d'Auto-Conception · PRD Exécutable

> **Version** : 2.0 · **Date** : Juillet 2026  
> **Paradigme** : Agentic Engineering / Spec-Driven Development (SDD) / Contract-First  
> **Modèles** : Claude Fable 5 (orchestrateur) · Claude Sonnet 4.6 (exécution)  
> **Environnement** : Claude Code v2.1.154+ (workflows dynamiques, subagents, hooks)  
> **Projet cible** : SIGFA — Système Intelligent de Gestion des Files d'Attente (voir SIGFA_PROMPT_v5.md)  
> **Piliers v2** : ① Backend API-First 100% — le contrat OpenAPI précède tout code · ② Test Total — rien n'existe sans son test, zéro exception

---

# PARTIE I — LE PARADIGME

## 1. De la conversation à l'orchestration

L'ère du "vibe coding" (décrire → recevoir du code → itérer en conversation) est terminée pour les projets de production. La méthode moderne est l'**agentic engineering** : le développeur n'écrit plus le code, il orchestre des agents contre des spécifications précises, avec supervision humaine aux points de contrôle.

Cinq principes fondateurs :

**1. La spec est l'artefact, le code est le produit dérivé.**
Comme un fichier `.c` compile vers un binaire, un PRD bien écrit "compile" vers du code via les agents. Si le code est mauvais, on corrige la spec et on régénère — jamais l'inverse.

**2. Un cerveau planifie, plusieurs mains exécutent.**
Le modèle le plus capable (Fable 5) fait ce qui est difficile : comprendre l'intention, découper, arbitrer, vérifier. Les modèles d'exécution (Sonnet) font ce qui est connu : implémenter une story précise avec des critères d'acceptation clairs. Cette séparation divise les coûts par 5-10x sans perte de qualité.

**3. Le contrat API précède tout code — API-First 100%.**
Aucun frontend, aucune borne, aucune app mobile ne commence avant que le contrat OpenAPI de son périmètre soit écrit, validé et mocké. Le backend n'est pas "une des couches" : c'est la **colonne vertébrale** dont tous les clients (web, kiosque, mobile, futurs partenaires) sont des consommateurs interchangeables. Le contrat est la frontière ; de part et d'autre, les équipes-agents travaillent en parallèle sans jamais se bloquer.

**4. Rien n'existe sans son test — Test Total.**
Chaque ligne de code produite par un agent naît avec son test, dans le même commit. Un code sans test n'est pas "du code à tester plus tard" : c'est un code **inexistant** aux yeux du système — les gates le rejettent automatiquement. Le test n'est pas une phase, c'est une propriété du code.

**5. Chaque erreur améliore le système, pas seulement le code.**
Quand un agent échoue, on ne corrige pas juste le bug — on enrichit le PRD, les leçons (`/lesson`), ou le CLAUDE.md pour que cette classe d'erreur ne se reproduise jamais. Le système devient plus fiable à chaque itération.

## 2. Pourquoi cette architecture à deux niveaux

| Rôle | Modèle | Responsabilité | Pourquoi ce modèle |
|---|---|---|---|
| **Orchestrateur** | Claude Fable 5 | Comprendre le besoin, générer le PRD, découper en stories, dispatcher, vérifier les coutures inter-modules, arbitrer les conflits | Raisonnement maximal requis pour la planification et la revue — utilisé uniquement sur ces moments, pas sur chaque token de code |
| **Exécutants** | Claude Sonnet 4.6 | Implémenter une story isolée : code + tests + docs, dans un contexte focalisé | Excellent en code, rapide, coût maîtrisé — chaque subagent reçoit un contexte propre limité à sa couche |
| **Vérificateurs** | Sonnet 4.6 (panel) | Relire adversarialement le travail des exécutants : sécurité, style, couverture tests | La diversité des angles (3 relecteurs spécialisés) attrape ce qu'un seul relecteur manque |

Le problème que ça résout : la **dilution d'attention**. Un seul agent avec 200k tokens de contexte qui tient à la fois le backend Hono, les schémas Drizzle, le kiosque Electron et le dashboard Next.js finit par contaminer les couches (appliquer un pattern backend dans un composant React). Des subagents isolés ne font jamais cette erreur : ils ne voient jamais les règles des autres couches.

---

# PARTIE II — L'ARCHITECTURE D'ORCHESTRATION

## 3. Topologie des agents SIGFA

```
                    ┌─────────────────────────────┐
                    │   ORCHESTRATEUR (Fable 5)    │
                    │   Thread principal Claude    │
                    │   Code — ne produit JAMAIS   │
                    │   de diff lui-même           │
                    └──────────┬──────────────────┘
                               │ dispatch (Task tool)
                               ▼ ÉTAPE 0 (racine du DAG, API-First)
                    ┌─────────────────────────────┐
                    │  agent-contract (Sonnet)     │
                    │  Contrat OpenAPI + événements│
                    │  → types, client, MOCK       │
                    └──────────┬──────────────────┘
                               │ contrat validé
        ┌──────────┬───────────┼───────────┬──────────────┐
        ▼          ▼           ▼           ▼              ▼
   ┌─────────┐┌─────────┐┌──────────┐┌──────────┐┌──────────────┐
   │ agent-  ││ agent-  ││ agent-   ││ agent-   ││ agent-       │
   │ api     ││ database││ web      ││ kiosk    ││ mobile       │
   │ (Sonnet)││ (Sonnet)││ (Sonnet) ││ (Sonnet) ││ (Sonnet)     │
   │         ││         ││          ││          ││              │
   │ implé-  ││ Drizzle ││ contre le││ contre le││ contre le    │
   │ mente le││ schema  ││ MOCK     ││ MOCK     ││ MOCK         │
   │ VRAI    ││ + RLS   ││ Next.js  ││ Electron ││ Expo         │
   │ contrat ││ + tests ││ dashboard││ borne    ││ React Native │
   │ TDD 🔴🟢 ││ tenant  ││ TDD 🔴🟢  ││ TDD 🔴🟢  ││ TDD 🔴🟢      │
   └────┬────┘└────┬────┘└────┬─────┘└────┬─────┘└──────┬───────┘
        │          │          │           │             │
        └──────────┴──────────┼───────────┴─────────────┘
                               ▼ résultats (JSON structuré + preuves rouge/vert)
                    ┌─────────────────────────────┐
                    │   PANEL DE VÉRIFICATION      │
                    │   (fan-out parallèle Sonnet) │
                    │  · security-reviewer         │
                    │  · test-coverage-checker     │
                    │  · style-conformance         │
                    │  + Schemathesis (contrat)    │
                    └──────────┬──────────────────┘
                               ▼ verdicts
                    ┌─────────────────────────────┐
                    │   ORCHESTRATEUR (Fable 5)    │
                    │   Synthèse · vérifie les     │
                    │   coutures · PASS / RETRY /  │
                    │   ESCALATE-TO-HUMAN          │
                    └─────────────────────────────┘
```

### Règle d'or de l'orchestrateur
> **Le thread principal planifie, dispatche, relit et vérifie. Il ne produit jamais de diffs.**
> Chaque subagent reçoit un contexte propre limité à sa couche : l'agent backend ne lit que les règles backend, l'agent kiosque que les conventions du kiosque. L'orchestrateur vérifie les coutures (contrat API ↔ types frontend, schéma DB ↔ validation Zod).

## 4. Définition des subagents (`.claude/agents/`)

Chaque subagent SIGFA est un fichier markdown avec frontmatter. Modèle assigné par agent :

```markdown
---
name: agent-api
description: Implémente les routes Hono, la validation Zod et la logique métier
  backend de SIGFA. À dispatcher pour toute story touchant apps/api/.
model: sonnet
tools: Read, Write, Edit, Bash, Grep, Glob
---

Tu es le développeur backend SIGFA. Ton périmètre : apps/api/ uniquement.

## Règles de ta couche
- Hono 4.x, TypeScript strict, aucun `any`
- Toute route : validation Zod en entrée (schémas depuis @sigfa/schemas)
- Multi-tenant : chaque handler passe par le middleware RLS
  (set app.current_bank_id) — JAMAIS de requête sans contexte tenant
- Toute route documentée OpenAPI à la création
- Tests Vitest + Supertest générés EN MÊME TEMPS que le code

## Contrat de sortie (obligatoire)
Termine toujours par un bloc JSON :
{
  "status": "complete" | "blocked",
  "files_created": [...],
  "files_modified": [...],
  "api_contracts": [{ "method": "POST", "route": "/api/v1/...", "input": "SchemaName", "output": "SchemaName" }],
  "tests_added": <int>,
  "notes_for_orchestrator": "dépendances inter-couches à vérifier"
}
```

Les cinq agents d'exécution suivent le même gabarit avec leur périmètre :

| Agent | Périmètre | Spécificités du contexte injecté |
|---|---|---|
| `agent-api` | `apps/api/` | Règles Hono + RLS + contrats OpenAPI |
| `agent-database` | `packages/database/` | Schéma Drizzle, migrations, policies RLS, seed |
| `agent-web` | `apps/web/` | Next.js 15, shadcn/ui, Zustand, Socket.io client |
| `agent-kiosk` | `apps/kiosk/` | UX borne (boutons ≥80px), offline Dexie.js, next-intl (FR/Dioula/Baoulé/EN), Web Speech API |
| `agent-mobile` | `apps/mobile/` | Expo SDK 51, MMKV offline, push FCM |

Et trois agents de vérification (lecture seule — `tools: Read, Grep, Glob, Bash` sans Write) :

| Agent | Angle de relecture |
|---|---|
| `security-reviewer` | Fuite inter-tenant, injection, secrets en dur, auth manquante, conformité UEMOA |
| `test-coverage-checker` | Couverture ≥80% nouveaux fichiers, cas limites du PRD couverts (offline, NO_SHOW, SLA dépassé) |
| `style-conformance` | Conventions SIGFA (kebab-case, JSDoc, imports absolus, Conventional Commits) |

---

# PARTIE III — ARCHITECTURE API-FIRST 100%

## 5. Le contrat OpenAPI est la colonne vertébrale

### Principe absolu

```
        ❌ CODE-FIRST (interdit)              ✅ API-FIRST (obligatoire)

   Backend codé → doc générée après      Contrat OpenAPI écrit et validé
        │                                        │
   Frontends attendent le backend          Mock server généré du contrat
        │                                        │
   Le contrat "émerge" du code            Backend ET frontends démarrent
   (instable, non versionné)              EN PARALLÈLE contre le contrat
        │                                        │
   Chaque changement backend             Le contrat est versionné, breaking
   casse silencieusement les clients      change = montée de version explicite
```

**Règle** : chaque module SIGFA commence par une story `CONTRACT-xxx` qui produit le fichier OpenAPI de son périmètre. Cette story est **toujours la racine du DAG** — rien d'autre ne peut démarrer avant qu'elle soit DONE et validée.

### Pipeline du contrat

```
[1] CONTRAT      agent-contract (Sonnet) rédige packages/contracts/
     │           openapi/module-N.yaml à partir des stories EARS.
     │           Chaque endpoint : method, route, schéma d'entrée,
     │           schéma de sortie, TOUS les codes d'erreur, exemples.
     ▼
[2] REVUE        Fable 5 vérifie : cohérence REST, nommage, pagination,
     │           versioning /api/v1, idempotence des mutations critiques
     │           (émission ticket offline), sécurité (auth sur chaque
     │           route, contexte tenant obligatoire).
     ▼
[3] GATE HUMAIN  Le Tech Lead valide le contrat. Il est commité.
     │           À partir d'ici, il est LA LOI.
     ▼
[4] GÉNÉRATION   Depuis le contrat, génération automatique de :
     │           · Types TypeScript partagés   → @sigfa/contracts
     │           · Schémas Zod                 → validation runtime
     │           · Client API typé             → consommé par web/kiosk/mobile
     │           · Mock server (Prism)         → les frontends codent contre lui
     │           · Squelettes de tests contrat → voir Partie IV
     ▼
[5] PARALLÈLE    agent-api implémente le vrai backend
                 PENDANT QUE agent-web / agent-kiosk / agent-mobile
                 codent contre le mock. Zéro blocage inter-équipes.
```

### Règles du contrat — non négociables

| # | Règle | Enforcement |
|---|---|---|
| C1 | Toute communication client ↔ serveur passe par le contrat OpenAPI. Aucun endpoint "caché", aucun accès direct DB depuis un frontend | Le panel `security-reviewer` rejette tout fetch vers une route absente du contrat |
| C2 | Le contrat définit **tous** les cas d'erreur (400, 401, 403, 404, 409, 422, 429, 500) avec leur schéma de réponse — pas seulement le happy path | Gate : un endpoint sans schéma d'erreur ne compile pas les types |
| C3 | Toute mutation critique est **idempotente** par clé client (uuid local) — émission ticket, sync offline, clôture | Test de contrat obligatoire : rejouer 2x = même résultat |
| C4 | Breaking change = nouvelle version `/api/v2`, jamais de modification silencieuse d'un contrat publié | Diff automatique du contrat en CI : breaking détecté = build rouge |
| C5 | Les événements temps réel (Socket.io) ont aussi leur contrat : `packages/contracts/events/` — nom, payload Zod, émetteur, consommateurs | Même pipeline de génération de types |
| C6 | Le multi-tenant est dans le contrat : chaque route documente son scope (bank / agency) et son header/claim de contexte | `security-reviewer` vérifie l'alignement contrat ↔ middleware RLS |

### Nouvel agent : `agent-contract`

```markdown
---
name: agent-contract
description: Rédige et fait évoluer les contrats OpenAPI et les contrats
  d'événements Socket.io. Racine du DAG de chaque module. Aucune logique
  métier — uniquement des contrats.
model: sonnet
tools: Read, Write, Edit, Grep, Glob
---

Tu es l'architecte de contrats SIGFA. Ton périmètre : packages/contracts/ uniquement.

## Règles
- OpenAPI 3.1, un fichier par module : openapi/module-N.yaml
- Chaque endpoint : summary, description, TOUS les codes de réponse,
  exemples requête/réponse, tag du module
- Schémas réutilisables dans components/schemas — jamais de duplication
- Pagination standard : ?page=&limit= avec enveloppe { data, meta }
- Erreurs standard : { error: { code, message, details? } }
- Événements Socket.io dans events/module-N.ts (nom + schéma Zod payload)

## Contrat de sortie
{
  "status": "complete",
  "contract_files": [...],
  "endpoints_defined": <int>,
  "events_defined": <int>,
  "breaking_changes": [] | ["description + version cible"],
  "notes_for_orchestrator": "..."
}
```

### Impact sur le DAG des modules

```
                    CONTRACT-M0 (agent-contract)
                          │  contrat validé + mock généré
          ┌───────────────┼────────────────────────┐
          ▼               ▼                        ▼
   DB-001..004      API-010..025           WEB-030..040  KIOSK-050..060
   (agent-database) (agent-api,            (agent-web,   (agent-kiosk,
    schéma + RLS     implémente le          code contre   code contre
    d'abord)         VRAI contrat)          le MOCK)      le MOCK)
          │               │                        │
          └───────┬───────┘                        │
                  ▼                                │
        Tests de contrat : le vrai backend         │
        passe-t-il exactement le contrat ?         │
                  │                                │
                  └───────────┬────────────────────┘
                              ▼
                  Bascule mock → backend réel
                  (un flag d'URL — zéro changement de code client)
```

> **Le gain** : les frontends n'attendent jamais le backend. Le jour où le vrai backend est prêt, les clients basculent du mock au réel en changeant une URL — s'ils ont respecté le contrat, tout fonctionne. Les tests de contrat (Partie IV) garantissent que le backend réel honore exactement ce que le mock promettait.

---



# PARTIE IV — ARCHITECTURE DE TEST TOTAL

## 6. Doctrine : rien n'existe sans son test

### Le contrat de naissance du code

```
   Tout code produit par un agent naît en TRIPLET indivisible :

        ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
        │   LE CODE    │ + │   SON TEST   │ + │   SA DOC     │
        └──────────────┘   └──────────────┘   └──────────────┘
                     UN SEUL ET MÊME COMMIT

   Un commit qui ajoute du code sans test correspondant est
   REJETÉ automatiquement par le hook pre-commit — il n'atteint
   jamais la CI, encore moins la revue.
```

Ce n'est pas de la discipline, c'est de l'**architecture** : les agents Sonnet ont l'instruction de générer les tests en même temps que le code, les gates vérifient, et les hooks rendent le contournement impossible. Trois couches d'enforcement, comme pour le pattern orchestrateur.

### La pyramide de test SIGFA

```
                        ▲ Peu nombreux, lents, haute confiance
                       ╱ ╲
                      ╱E2E╲          Playwright — parcours critiques complets :
                     ╱─────╲         client prend ticket → agent appelle →
                    ╱ CONTRAT╲       service → feedback. Kiosque + dashboard.
                   ╱──────────╲
                  ╱ INTÉGRATION╲     Le backend réel honore-t-il EXACTEMENT
                 ╱──────────────╲    le contrat OpenAPI ? (Schemathesis
                ╱   COMPOSANT    ╲   contre openapi.yaml) + tests Socket.io
               ╱──────────────────╲
              ╱     UNITAIRES      ╲  Routes Hono + vraie DB (Testcontainers
             ╱──────────────────────╲ PostgreSQL) : RLS, transactions, queues
            ▼ Très nombreux, rapides ▼
                                      Composants React/RN isolés (Testing
   UNITAIRES : logique pure —         Library) : borne offline, écran appel
   services, calculs TMA/TMT,
   règles de priorité, helpers
   — Vitest, <10ms par test
```

| Niveau | Outil | Périmètre | Qui l'écrit | Quand |
|---|---|---|---|---|
| **Unitaire** | Vitest | Logique pure : calculs KPI, règles de file, priorités, utils | L'agent exécutant, même commit | Avec chaque fonction |
| **Composant** | Testing Library + Vitest | Composants React/RN isolés : états offline, loading, erreur | agent-web / kiosk / mobile | Avec chaque composant |
| **Intégration** | Vitest + Supertest + **Testcontainers** | Routes API contre une **vraie** PostgreSQL éphémère : RLS réel, migrations réelles, Redis réel | agent-api / agent-database | Avec chaque route |
| **Contrat** | Schemathesis (property-based sur OpenAPI) | Le backend implémente-t-il exactement le contrat ? Fuzzing automatique de chaque endpoint depuis le YAML | Généré depuis le contrat + enrichi par agent-api | À chaque endpoint |
| **E2E** | Playwright | Parcours utilisateur complets multi-apps, y compris coupure réseau simulée | Agent dédié fin de module | Fin de chaque module |
| **Charge** | k6 | Pic fin de mois : 100 tickets/min/agence, 50 agences simultanées, latence Socket.io <500ms p95 | Story dédiée | Avant chaque mise en prod |
| **Mutation** | Stryker | Les tests détectent-ils vraiment les bugs ? Score de mutation ≥ 60% sur le core engine | Audit périodique | Fin de module core |

### Règles de test — non négociables

| # | Règle | Enforcement |
|---|---|---|
| T1 | **Aucun commit sans test** : tout fichier source nouveau/modifié doit avoir son fichier de test touché dans le même commit | Hook pre-commit : diff sans test correspondant = rejet |
| T2 | **Couverture ≥ 85% sur tout nouveau fichier**, ≥ 80% global — et la couverture ne peut jamais **baisser** | Gate CI : ratchet de couverture, baisse = build rouge |
| T3 | **Chaque critère d'acceptation EARS d'une story = au moins un test nommé d'après la story** (`STORY-042: sync offline sans doublon`) | `test-coverage-checker` mappe stories ↔ tests, story sans test = FAIL |
| T4 | **Chaque cas d'erreur du contrat OpenAPI a son test** : les 401, 403, 409, 422 ne sont pas optionnels | Schemathesis génère + vérifie automatiquement depuis le YAML |
| T5 | **Les tests d'intégration utilisent de vraies dépendances** (Testcontainers PostgreSQL + Redis), jamais de mock de la DB — le RLS ne se teste pas sur un mock | Convention d'agent + revue panel |
| T6 | **Le multi-tenant a sa suite dédiée** : chaque table, chaque route testée pour la fuite inter-tenant (requête banque A ne retourne JAMAIS une donnée banque B) | Suite `tenant-isolation.test.ts` obligatoire par module |
| T7 | **L'offline a sa suite dédiée** : perte réseau, génération locale, sync idempotente, double-sync, reprise après crash | Suite `offline.test.ts` obligatoire pour kiosk et mobile |
| T8 | **Un test flaky est un bug P1** : réparé ou supprimé sous 24h, jamais ignoré ni masqué par retry | Détection CI : 2 résultats différents sur même commit = ticket auto |
| T9 | **Tout bugfix commence par un test qui reproduit le bug** (rouge), puis le fix (vert) — le test reste pour toujours | Story de fix sans test rouge initial = FAIL en Boucle 2 |
| T10 | **Les fixtures sont générées depuis les schémas Zod** (factories typées) — jamais de données de test manuelles qui divergent du schéma | Package partagé `@sigfa/factories` |

### Suites de test critiques SIGFA (obligatoires par module)

```
packages/testing/
├── tenant-isolation/        # T6 — la suite la plus critique du projet
│   └── Pour CHAQUE table : créer données banque A et B,
│       requêter avec contexte A → vérifier ZÉRO ligne de B,
│       tenter l'injection de bank_id dans le payload → rejeté
├── offline-resilience/      # T7 — le terrain ivoirien
│   └── Couper réseau mi-parcours, tickets locaux séquentiels,
│       sync idempotente (rejouer 2x = zéro doublon),
│       crash borne pendant sync → reprise propre
├── realtime-guarantees/     # Socket.io
│   └── ticket:called reçu par l'écran <500ms,
│       reconnexion WebSocket → état resynchronisé,
│       2 agents appellent en même temps → un seul gagne (lock)
├── sla-engine/              # Cœur métier
│   └── Calculs TMA/TMT exacts, priorités (VIP > PMR > Standard),
│       NO_SHOW après timeout, débordement inter-guichets,
│       machine à états du ticket exhaustive (toutes transitions)
└── contract/                # T4 — généré depuis OpenAPI
    └── Schemathesis : fuzzing de chaque endpoint,
        tous les codes d'erreur, idempotence des mutations
```

## 7. Le TDD agentique — comment les agents travaillent

Chaque story suit ce micro-cycle **à l'intérieur** de la Boucle 2 :

```
   ┌────────────────────────────────────────────────────────┐
   │            MICRO-CYCLE TDD (dans chaque story)          │
   │                                                         │
   │  [a] ROUGE    L'agent écrit D'ABORD les tests depuis    │
   │       │       les critères d'acceptation EARS de la     │
   │       │       story. Il les exécute : ils DOIVENT       │
   │       │       échouer (sinon le test ne teste rien).    │
   │       ▼                                                 │
   │  [b] VERT     L'agent implémente le minimum qui fait    │
   │       │       passer les tests. Exécution : tout vert.  │
   │       ▼                                                 │
   │  [c] REFACTOR L'agent nettoie (noms, duplication,       │
   │       │       découpage) — les tests restent verts.     │
   │       ▼                                                 │
   │  [d] PREUVE   Le contrat de sortie JSON inclut :        │
   │               tests_written_first: true,                │
   │               red_run_output: "..." (preuve du rouge),  │
   │               green_run_output: "..." (preuve du vert)  │
   └────────────────────────────────────────────────────────┘
```

> **Pourquoi exiger la preuve du rouge** : un agent qui écrit le code puis les tests a posteriori écrit des tests qui valident ce que le code fait — pas ce que la story demande. Le rouge initial prouve que le test encode l'exigence, pas l'implémentation. L'orchestrateur rejette tout contrat de sortie sans `red_run_output`.

### Gate de test enrichi (l'étape [4] de la Boucle 2, version complète)

```
[4] GATES — chaîne stricte, arrêt au premier FAIL :
    1. lint + typecheck (aucun any, aucun ts-ignore)
    2. Hook : chaque fichier source du diff a son test dans le diff (T1)
    3. Tests unitaires + composants du périmètre modifié
    4. Tests d'intégration (Testcontainers) du périmètre
    5. Tests de contrat Schemathesis si une route a changé (T4)
    6. Suite tenant-isolation si une table/route a changé (T6)
    7. Suite offline si kiosk/mobile touché (T7)
    8. Mapping stories ↔ tests : chaque critère EARS couvert (T3)
    9. Ratchet de couverture : ≥85% nouveaux fichiers, jamais de baisse (T2)
```

---

# PARTIE V — LE PRD EXÉCUTABLE

## 8. Structure du PRD SIGFA

Le PRD n'est pas un document Word qu'on lit — c'est un **artefact exécutable versionné dans Git** (`docs/prd/`), découpé en stories atomiques que les agents consomment une par une. Format : Markdown + notation EARS pour les exigences.

### Notation EARS (Easy Approach to Requirements Syntax)

Chaque exigence suit un des cinq patterns — zéro ambiguïté, directement testable par un agent :

```
UBIQUITAIRE   : Le système doit [comportement permanent]
  → "Le système doit filtrer chaque requête par bank_id via RLS."

ÉVÉNEMENTIEL  : QUAND [déclencheur], le système doit [réponse]
  → "QUAND un agent clique 'Appeler suivant', le système doit émettre
     l'événement Socket.io ticket:called vers l'écran d'appel en <500ms."

CONDITIONNEL  : SI [condition], ALORS le système doit [réponse]
  → "SI le réseau est coupé, ALORS la borne doit générer les tickets
     localement dans IndexedDB avec numérotation séquentielle garantie."

OPTIONNEL     : LÀ OÙ [feature activée], le système doit [comportement]
  → "LÀ OÙ la langue Dioula est activée, la borne doit annoncer
     vocalement le numéro appelé en Dioula."

INDÉSIRABLE   : SI [condition anormale], le système doit [mitigation]
  → "SI un agent se déconnecte avec un ticket en cours, le système doit
     repasser le ticket en WAITING avec priorité PRIORITY et alerter
     le manager immédiatement."
```

### Gabarit d'une story

```markdown
## STORY-042 : Émission de ticket en mode offline

**Module** : 1 — Gestion des Files · **Agent cible** : agent-kiosk
**Dépend de** : STORY-038 (schéma Ticket), STORY-040 (Service Worker)
**Statut** : TODO | IN_PROGRESS | REVIEW | DONE | BLOCKED

### Exigences (EARS)
- SI le réseau est indisponible, ALORS la borne doit générer les tickets
  localement dans IndexedDB (Dexie.js) avec numérotation séquentielle.
- QUAND le réseau revient, le système doit synchroniser les tickets
  locaux vers l'API sans créer de doublon (idempotence par uuid local).
- Le système doit afficher un badge "Hors ligne" visible sur la borne
  pendant toute la durée de la coupure.

### Critères d'acceptation (testables)
- [ ] Test : couper le réseau → émettre 5 tickets → numéros séquentiels
- [ ] Test : reconnexion → les 5 tickets apparaissent en base, zéro doublon
- [ ] Test : double sync (retry) → toujours zéro doublon (idempotence)
- [ ] Le badge offline apparaît en <2s après perte réseau

### Hors scope de cette story
- La sync des feedbacks clients (STORY-051)
- Le mode dégradé du dashboard manager (STORY-047)
```

**Règles de granularité** : une story = un agent, une couche, une session. Si une story touche deux apps du monorepo, l'orchestrateur la découpe. Les dépendances forment un DAG que l'orchestrateur résout (stories indépendantes → dispatch parallèle ; dépendantes → chaîne séquentielle).

## 9. Le fichier CLAUDE.md — constitution du projet

À la racine du monorepo, le `CLAUDE.md` est la mémoire persistante que chaque session recharge. Il contient la section d'application du pattern :

```markdown
# SIGFA — CLAUDE.md

## Routage du travail — Architecture Orchestrateur + Subagents

**Le thread principal est l'orchestrateur — il planifie, dispatche,
relit et vérifie. Il ne produit JAMAIS de diffs lui-même.**

Règles de routage :
- Toute modification dans apps/api/       → dispatcher agent-api
- Toute modification dans packages/database/ → dispatcher agent-database
- Toute modification dans apps/web/       → dispatcher agent-web
- Toute modification dans apps/kiosk/     → dispatcher agent-kiosk
- Toute modification dans apps/mobile/    → dispatcher agent-mobile
- Après tout lot d'implémentation → fan-out du panel de vérification
  (security-reviewer + test-coverage-checker + style-conformance en parallèle)

## Références obligatoires
- Vision produit & périmètre : SIGFA_PROMPT_v5.md (source de vérité)
- PRD actif : docs/prd/ (stories versionnées)
- Leçons apprises : .claude/lessons/ (enrichi à chaque échec)

## Hors scope définitif (ne jamais implémenter)
Core Banking, CRM, Mobile Money, USSD, biométrie — voir section 4 du v5.
```

> **Enforcement au-delà du prompt** : les instructions en langage naturel se diluent dans les longues sessions (l'agent finit par éditer directement au lieu de dispatcher). On ajoute donc une couche de **hooks** : un hook `PreToolUse` qui bloque tout `Edit`/`Write` du thread principal sur les fichiers de `apps/` et `packages/`, forçant le passage par les subagents. La guidance donne l'intention, le hook la rend incontournable.

---

# PARTIE VI — LES BOUCLES D'AUTO-CONCEPTION

## 10. Boucle 1 — Auto-conception du PRD (Fable 5)

Avant toute ligne de code, l'orchestrateur fait converger le PRD par itérations adversariales sur lui-même :

```
   ┌────────────────────────────────────────────────────┐
   │              BOUCLE PRD (auto-conception)           │
   │                                                     │
   │  [1] GÉNÉRER   Fable 5 rédige le PRD draft depuis  │
   │       │        SIGFA_PROMPT_v5.md + le besoin       │
   │       ▼                                             │
   │  [2] CRITIQUER Fan-out 3 subagents critiques :      │
   │       │        · critic-completeness (que manque-t-il ?)│
   │       │        · critic-ambiguity (qu'est-ce qu'un  │
   │       │          agent devrait deviner ?)           │
   │       │        · critic-feasibility (contradictions  │
   │       │          techniques, terrain CI ignoré ?)    │
   │       ▼                                             │
   │  [3] ARBITRER  Fable 5 intègre ou rejette chaque    │
   │       │        critique — avec justification écrite  │
   │       ▼                                             │
   │  [4] CONVERGÉ ?                                     │
   │       ├─ NON → retour [2]  (max 3 itérations)       │
   │       └─ OUI → [5] GATE HUMAIN                      │
   │                Le product owner valide le PRD.      │
   │                Aucun code avant cette validation.    │
   └────────────────────────────────────────────────────┘
```

Critère de convergence : les 3 critiques ne remontent plus que des points mineurs (aucun `BLOCKER`, aucun `MAJOR`). Le PRD validé est commité — il devient le contrat.

## 11. Boucle 2 — Exécution autonome par story (type Ralph)

C'est la boucle de production, exécutable en autonomie (y compris la nuit) :

```
   ┌──────────────────────────────────────────────────────────┐
   │           BOUCLE STORY (par story, jusqu'à épuisement)     │
   │                                                           │
   │  [1] PICK      Orchestrateur lit docs/prd/ → prend la     │
   │       │        prochaine story TODO dont les dépendances   │
   │       │        sont DONE (résolution du DAG)               │
   │       ▼                                                    │
   │  [2] DISPATCH  Envoie la story à l'agent de sa couche     │
   │       │        avec : la story + les leçons pertinentes    │
   │       │        + le dernier échec si c'est un retry        │
   │       ▼                                                    │
   │  [3] EXECUTE   Sonnet implémente : code + tests + docs    │
   │       │        Retourne le JSON de contrat de sortie       │
   │       ▼                                                    │
   │  [4] GATES     Chaîne de vérifications automatiques :     │
   │       │        lint → typecheck → tests unitaires →        │
   │       │        tests d'acceptation de la story →           │
   │       │        smoke test API/frontend                     │
   │       ▼                                                    │
   │  [5] VERDICT                                              │
   │       ├─ PASS  → commit (Conventional Commits),            │
   │       │         story → DONE, retour [1]                   │
   │       ├─ FAIL  → écrire last_failure.txt, retour [2]       │
   │       │         (max 3 retries par story)                  │
   │       └─ 3 FAILS → story → BLOCKED + /lesson auto-généré  │
   │                    → ESCALATE-TO-HUMAN                     │
   └──────────────────────────────────────────────────────────┘
```

**Garde-fous de la boucle autonome** (non négociables) :
- **Budget dur** : plafond de subagents par session ; la boucle refuse de le dépasser (un plan emballé ne peut pas épuiser le quota)
- **Journalisation durable** : chaque phase écrit son rapport dans `docs/sessions/{date}/` — audit trail complet, reprise possible après interruption
- **Idempotence** : relancer la boucle ne rejoue jamais une story DONE
- **Escalade humaine** : 3 échecs consécutifs = arrêt sur cette story, jamais de contournement silencieux des critères d'acceptation

## 12. Boucle 3 — Vérification adversariale (panel)

Après chaque **lot** de stories (fin de module ou fin de session), l'orchestrateur lance le panel en fan-out parallèle :

```
   Lot de stories DONE
          │
          ├──────────────┬──────────────────┐
          ▼              ▼                  ▼
   security-reviewer  test-coverage    style-conformance
   (fuite tenant ?    (cas limites     (conventions
    injection ?        PRD couverts ?)   respectées ?)
    secrets ?)
          │              │                  │
          └──────────────┴──────────────────┘
                         ▼
              Fable 5 synthétise les verdicts
                         │
          ┌──────────────┼──────────────────┐
          ▼              ▼                  ▼
        PASS         FINDINGS            CRITICAL
     lot validé    → nouvelles stories  → rollback du lot
                     de correction        + escalade humaine
                     dans le PRD          + /lesson
```

La valeur du panel est la **diversité** : chaque relecteur est aveugle à ce que voient les autres, donc le panel attrape des combinaisons qu'un relecteur unique manquerait (ex. : une validation d'entrée manquante + un endpoint sans auth = vulnérabilité critique que ni l'un ni l'autre seul ne signalerait comme critique).

## 13. Boucle 4 — Méta-apprentissage (le système s'améliore)

```
   Échec ou finding détecté
          │
          ▼
   [1] DIAGNOSTIC — Fable 5 : est-ce un bug ponctuel
       ou une classe d'erreur récurrente ?
          │
          ├─ Ponctuel → story de fix, terminé
          │
          └─ Classe d'erreur ▼
   [2] REMONTER À LA SOURCE — où le système aurait-il
       dû l'empêcher ?
          ├─ PRD ambigu        → amender le PRD (EARS plus strict)
          ├─ Contexte agent    → enrichir .claude/agents/{agent}.md
          ├─ Leçon manquante   → /lesson → .claude/lessons/
          └─ Gate absent       → ajouter un hook ou un check
                                 dans la chaîne [4] de la Boucle 2
          │
          ▼
   [3] Le même type d'erreur ne peut structurellement
       plus se reproduire.
```

Exemple SIGFA concret : si `agent-web` oublie deux fois le fallback offline sur un composant dashboard, on n'ajoute pas juste le fallback — on ajoute au fichier `agent-web.md` la règle *"tout composant affichant des données temps réel doit définir son état offline"* + un check automatique dans le gate. L'erreur devient impossible, pas juste corrigée.

---

# PARTIE VII — WORKFLOW COMPLET SUR SIGFA

## 14. Séquence type : conception d'un module

Prenons le **Module 0 (MVP)** de SIGFA :

```
JOUR 1 — CONCEPTION (Fable 5, orchestrateur seul + critiques)
├── /effort high sur le thread principal
├── Boucle 1 : PRD du Module 0 auto-conçu et critiqué (3 itérations)
│     Sortie : docs/prd/module-0/ — ~25 stories EARS avec DAG
├── GATE HUMAIN : validation du PRD par le product owner
└── Fable 5 génère le plan de dispatch — CONTRACT-M0 en racine du DAG

JOUR 2 — CONTRAT (API-First : rien ne démarre avant)
├── CONTRACT-M0 → agent-contract : OpenAPI complet du module
│     (endpoints, TOUS les codes d'erreur, événements Socket.io)
├── Revue Fable 5 : REST, idempotence, sécurité tenant, versioning
├── GATE HUMAIN : Tech Lead valide le contrat → commité, c'est LA LOI
└── Génération auto : types TS + Zod + client typé + MOCK server
      + squelettes Schemathesis

JOURS 3-N — EXÉCUTION PARALLÈLE (Boucle 2 autonome)
├── Vague 1 : STORY-001 à 004 → agent-database
│     (schéma Drizzle, RLS, migrations, seed + suite tenant-isolation)
├── Vague 2 — EN PARALLÈLE grâce au contrat :
│     ├── stories API → agent-api (implémente le VRAI contrat,
│     │     micro-cycle TDD : rouge → vert → refactor → preuve)
│     └── stories kiosque + web → agent-kiosk / agent-web
│           (codent contre le MOCK — zéro attente du backend)
├── Chaque story : gates 9 étapes → commit (code+test+doc) → suivante
├── Bascule mock → backend réel dès que Schemathesis valide le contrat
└── Nuit : la boucle tourne en autonomie ; au matin, revue des
      BLOCKED et des lessons générées

FIN DE MODULE — VÉRIFICATION (Boucle 3)
├── Panel adversarial sur l'ensemble du module
├── Suite E2E Playwright : parcours complets, coupure réseau simulée
├── k6 : charge fin de mois (100 tickets/min/agence)
├── Findings → stories de correction → mini-boucle 2
├── Fable 5 vérifie les coutures : contrat ↔ implémentation ↔ clients
└── GATE HUMAIN : démo staging + revue du rapport de session

APRÈS CHAQUE MODULE — MÉTA (Boucle 4)
└── Consolidation des lessons, mise à jour des agents et du CLAUDE.md
```

## 15. Points de contrôle humains (jamais automatisables)

L'autonomie des boucles ne supprime pas la supervision — elle la concentre là où elle a de la valeur :

| Gate | Quand | Qui | Décision |
|---|---|---|---|
| **PRD validé** | Fin de Boucle 1 | Product Owner | Le contrat est-il le bon produit ? |
| **Architecture** | Avant vague 1 d'un module | Tech Lead | Le plan de dispatch et le DAG sont-ils sains ? |
| **Stories BLOCKED** | 3 échecs d'une story | Développeur | Débloquer, redécouper, ou déscoper |
| **Fin de module** | Après Boucle 3 | PO + Tech Lead | Démo staging conforme aux critères de succès ? |
| **Sécurité CRITICAL** | Verdict du panel | Tech Lead immédiat | Rollback confirmé, cause racine traitée ? |

## 16. Structure de fichiers de la méthode

```
sigfa/
├── CLAUDE.md                        # Constitution : routage, références, hors scope
├── SIGFA_PROMPT_v5.md               # Vision produit (source de vérité métier)
├── .claude/
│   ├── agents/
│   │   ├── agent-contract.md        # ★ API-First : rédige les contrats (racine DAG)
│   │   ├── agent-api.md             # Exécutants (model: sonnet)
│   │   ├── agent-database.md
│   │   ├── agent-web.md
│   │   ├── agent-kiosk.md
│   │   ├── agent-mobile.md
│   │   ├── security-reviewer.md     # Panel (lecture seule)
│   │   ├── test-coverage-checker.md
│   │   ├── style-conformance.md
│   │   ├── critic-completeness.md   # Critiques PRD (Boucle 1)
│   │   ├── critic-ambiguity.md
│   │   └── critic-feasibility.md
│   ├── lessons/                     # Méta-apprentissage (Boucle 4)
│   └── hooks/
│       ├── block-main-thread-writes # Force le passage par les subagents
│       └── require-test-in-commit   # ★ T1 : rejette tout diff sans test
├── packages/
│   ├── contracts/                   # ★ API-First : LA LOI
│   │   ├── openapi/                 # module-0.yaml, module-1.yaml ...
│   │   ├── events/                  # Contrats Socket.io (nom + Zod payload)
│   │   └── generated/               # Types TS + client typé + mocks (auto)
│   ├── factories/                   # ★ T10 : fixtures générées depuis Zod
│   ├── testing/                     # ★ Suites critiques transverses
│   │   ├── tenant-isolation/        # T6 — anti-fuite inter-banques
│   │   ├── offline-resilience/      # T7 — terrain ivoirien
│   │   ├── realtime-guarantees/     # Socket.io <500ms, locks
│   │   ├── sla-engine/              # Machine à états ticket, KPIs
│   │   └── contract/                # Schemathesis depuis OpenAPI
│   ├── schemas/ · ui/ · config/ · database/
├── docs/
│   ├── prd/
│   │   ├── module-0/                # Stories EARS versionnées
│   │   │   ├── CONTRACT-M0.md       # ★ Toujours la racine du DAG
│   │   │   ├── STORY-001.md ...
│   │   │   └── _dag.md              # Graphe de dépendances
│   │   └── module-1/ ...
│   └── sessions/                    # Journaux d'exécution (audit trail)
│       └── 2026-07-10/
│           ├── 01-dispatch-plan.md
│           ├── 02-story-042-report.md
│           └── verdicts.json
└── apps/                            # Le code — produit dérivé du PRD + contrat
```

---

# PARTIE VIII — RÈGLES D'OR

## 17. Les 12 commandements de la méthode

1. **Le PRD d'abord, toujours.** Aucun code sans stories EARS validées par un humain.
2. **Le contrat API avant tout code.** La story CONTRACT est la racine de chaque DAG de module — backend et frontends démarrent en parallèle contre le contrat validé, les frontends contre le mock.
3. **L'orchestrateur ne code jamais.** Fable 5 planifie, dispatche, relit — les diffs viennent des subagents Sonnet.
4. **Un contexte par couche.** Chaque agent ne voit que les règles de son périmètre — c'est ce qui élimine la contamination inter-couches.
5. **Tout ce qui est développé est testé — dans le même commit.** Code + test + doc forment un triplet indivisible ; un hook pre-commit rejette tout diff sans test.
6. **Le test d'abord (rouge), le code ensuite (vert).** L'agent fournit la preuve du rouge dans son contrat de sortie — sans elle, la story est rejetée.
7. **Contrats de sortie structurés.** Tout subagent retourne du JSON validable, jamais de la prose libre — le rapport markdown est pour l'humain, le JSON pour la machine.
8. **Gates automatiques entre chaque story.** Les 9 étapes de la chaîne (lint → tenant-isolation → ratchet de couverture) — un FAIL ne passe jamais silencieusement.
9. **3 échecs = escalade humaine.** Jamais de contournement des critères d'acceptation pour "faire passer" une story.
10. **Chaque échec enrichit le système.** Lesson, règle d'agent, hook ou amendement PRD — la même erreur ne doit plus être possible.
11. **Vérification adversariale par panel.** La diversité des relecteurs attrape ce qu'un relecteur unique manque.
12. **L'humain garde les décisions produit.** Les gates humains ne sont pas un frein — ils sont là où le jugement a le plus de valeur.

## 18. Anti-patterns à bannir

| Anti-pattern | Pourquoi c'est un piège | À la place |
|---|---|---|
| Coder le backend avant le contrat | Le contrat "émerge" du code : instable, non versionné, les frontends attendent et cassent à chaque changement | Story CONTRACT en racine du DAG, mock immédiat, parallèle |
| Frontend qui appelle une route hors contrat | Couplage caché, incassable à détecter, brise la bascule mock→réel | `security-reviewer` rejette tout fetch hors contrat (C1) |
| "On testera après" / commit sans test | Le test a posteriori valide l'implémentation, pas l'exigence ; la dette de test ne se rembourse jamais | Hook T1 : le commit sans test n'existe pas ; TDD rouge→vert avec preuve |
| Mocker la base de données en test d'intégration | Le RLS, les transactions et les contraintes ne se testent pas sur un mock — fuite inter-tenant invisible | Testcontainers : vraie PostgreSQL éphémère (T5) |
| Ignorer/retry un test flaky | Il masque un vrai bug de concurrence (locks Socket.io, sync offline) | T8 : flaky = bug P1, réparé sous 24h |
| Orchestrer une tâche triviale | L'overhead coûte plus que le gain — corriger une typo n'a pas besoin de 5 agents | Tâche simple → agent unique en direct |
| Le thread principal qui "dépanne vite fait" | En longue session, l'attention se dilue et l'orchestrateur se met à éditer directement → bugs inter-couches | Hook d'enforcement qui bloque ses writes |
| Stories géantes multi-couches | Un agent qui touche API + DB + UI recrée la dilution qu'on voulait éliminer | Découper : 1 story = 1 couche = 1 agent |
| Agents parallèles sur les mêmes fichiers | Conflits de merge garantis | Le DAG sérialise ce qui partage des fichiers |
| Corriger le code sans corriger la spec | Le code régénéré depuis le PRD réintroduira le bug | La spec est la source : amender puis régénérer |
| PRD en prose vague | "L'app doit être rapide" n'est pas testable — l'agent devine | EARS : "QUAND X, le système doit Y en <Zms" |
| Faire confiance sans vérifier | Un PASS des tests ne garantit pas les coutures inter-modules | Panel adversarial + Schemathesis + revue Fable 5 |

---

## 19. Démarrage rapide

```bash
# 1. Initialiser la structure
mkdir -p .claude/{agents,lessons,hooks} docs/{prd,sessions} \
         packages/{contracts/{openapi,events,generated},factories,testing}

# 2. Écrire CLAUDE.md (constitution) + les 12 fichiers d'agents
#    → gabarits en Parties II, III et VII

# 3. Installer les 2 hooks d'enforcement
#    → block-main-thread-writes + require-test-in-commit

# 4. Lancer la conception (session Claude Code, effort high)
claude
> Tu es l'orchestrateur SIGFA. Lis CLAUDE.md et SIGFA_PROMPT_v5.md.
> Lance la Boucle 1 : génère le PRD du Module 0 en stories EARS
> avec CONTRACT-M0 en racine du DAG, puis fais-le critiquer par
> les 3 critiques en parallèle. Présente-moi le PRD convergé.

# 5. Après validation humaine → contrat d'abord
> PRD validé. Dispatche CONTRACT-M0 à agent-contract.
> À sa validation : génère types, client, mock et squelettes
> Schemathesis, puis lance la Boucle 2 en vagues parallèles.

# 6. Fin de module → Boucle 3
> Module 0 : toutes stories DONE, contrat honoré par Schemathesis.
> Lance le panel de vérification en fan-out + E2E + k6,
> et synthétise les verdicts.
```

---

*Méthode de Conception Agentique SIGFA v2.0 · Fable 5 orchestre · Sonnet exécute · Le contrat API précède tout · Rien n'existe sans son test · L'humain décide*
