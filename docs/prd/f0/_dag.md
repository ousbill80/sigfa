# VAGUE F0 — FONDATIONS · DAG

> Racine absolue du produit. Rien d'autre ne démarre avant F0 DONE.
> Statuts : `TODO → IN_PROGRESS → REVIEW → DONE | BLOCKED`
> **Révision** : v2 — amendée après critique (Boucle 1, itération 1)

```
INFRA-001 (monorepo pnpm + Turborepo 2)        ← racine absolue, dispatch seul
   ├──► INFRA-002 (Docker Compose dev)          ┐ développement PARALLÈLE
   ├──► INFRA-003 (CI GitHub Actions + ratchet) │ (worktrees isolés)
   ├──► INFRA-004 (lefthook : T1 + commitlint)  │ intégration SÉQUENTIELLE :
   └──► INFRA-005 (@sigfa/schemas·factories·testing) ┘ 002 → 003 → 004 → 005
```

## Fichiers de couture (correction critique — la parallélisation naïve était fausse)

`package.json` racine, `pnpm-lock.yaml` et `.env.example` sont partagés. Règles :
- **Développement** parallèle possible (chaque agent en worktree isolé, périmètres de fichiers disjoints hors couture) ;
- **Intégration séquentielle** par l'orchestrateur dans l'ordre `002 → 003 → 004 → 005`, avec `pnpm install` rejoué à chaque merge (lockfile) ;
- `.env.example` : créé par INFRA-001, modifié **uniquement** par INFRA-002 pendant la vague ;
- script `prepare` du package.json racine : ajouté par INFRA-004 à son intégration ;
- `tools/ci` : workspace créé (vide) par INFRA-001 ; INFRA-002 et INFRA-003 y ajoutent des **fichiers distincts** (`check-dev-env.test.ts` / `coverage-ratchet.ts` + `docker-smoke.test.ts`) ;
- `packages/testing` : INFRA-005 exclusivement — INFRA-003 n'y touche pas.

| ID | Titre | Agent | Dépend de | Statut |
|---|---|---|---|---|
| INFRA-001 | Monorepo pnpm + Turborepo 2, apps/ + packages/ + tools/ci, configs partagées (squelettes TS pur, zéro framework) | direct | — | DONE |
| INFRA-002 | Docker Compose dev : postgres16 + redis7 + api + web + kiosk (node:22-slim, bind mounts) | direct | INFRA-001 | TODO |
| INFRA-003 | CI GitHub Actions : lint → typecheck → test → build + ratchet couverture (tools/ci) | direct | INFRA-001 | TODO |
| INFRA-004 | Hooks git (lefthook ^1.7) : require-test-in-commit (T1) + commitlint ^19 | direct | INFRA-001 | TODO |
| INFRA-005 | @sigfa/schemas (primitifs), @sigfa/factories (T10, seedé + fast-check), @sigfa/testing (5 harness outillés) | agent-database (périmètre étendu — voir story) | INFRA-001 | TODO |

## Prérequis humains (avant intégration INFRA-003)
- Dépôt git initialisé + remote GitHub avec Actions activées.
- Branch protection main/staging (checks lint/typecheck/test/build requis) — config repo, vérifiée au gate de sortie.

## Backlog différé consigné (issu de la critique)
- **INFRA-006** (différée) : détection automatisée des tests flaky en CI (T8 — 2 résultats différents sur même commit = ticket auto). À planifier quand la suite grossit.
- **Amendement CONTRACT-009 proposé au PO** : ajouter explicitement le job CI de **diff de contrat OpenAPI** (C4 : breaking change = build rouge) à son périmètre.
- **Contrainte consignée pour MOB-001** : stratégie pnpm `node-linker` (ou config Metro) requise pour Expo/Metro en workspace — décision à prendre à l'installation d'Expo (F4), pas en F0.

## Sortie de vague (gate humain)
`pnpm install && pnpm turbo run lint typecheck test build` vert à la racine (12 workspaces) · compose up healthy (images pré-tirées) · **run CI réel vert sur PR + caches restaurés + needs vérifié + branch protection active** (critères `INFRA-003[gate]`) · commit sans test rejeté localement · les 5 harness de suites critiques exécutables (PG + Redis réels).
