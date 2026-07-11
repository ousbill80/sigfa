# Session 2026-07-11 — Boucle 2 · Dispatch parallèle INFRA-002‖003‖004‖005

**GO humain reçu** : F0 complet. INFRA-001 DONE (d17bda3) débloque les 4 stories restantes.

## Stratégie (conforme `_dag.md` v2)
- **Développement parallèle** : chaque agent dans un worktree git dédié (`../wt-infra-00X`, branche `story/infra-00X`) — zéro contention de fichiers pendant le dev.
- **Intégration séquentielle par l'orchestrateur** : merge `002 → 003 → 004 → 005` dans le tree principal ; à chaque merge : résolution d'union sur les fichiers de couture (pnpm-lock.yaml régénéré par `pnpm install`, `tools/ci/package.json` union des devDeps), puis gates rejoués (`turbo run lint typecheck test build` + suites spécifiques).
- Fichiers de couture identifiés : `pnpm-lock.yaml` (tous), `tools/ci/package.json` (002/003/004), `package.json` racine (004 seul : prepare + devDeps).

## Propriété des fichiers par story (anti-collision)
| Story | Fichiers possédés |
|---|---|
| 002 | docker-compose.yml · scripts/check-dev-env.sh · .env.example · tools/ci/src/check-dev-env.test.ts |
| 003 | .github/workflows/ci.yml · coverage-baseline.json · tools/ci/src/{coverage-ratchet*,docker-smoke.test,ci-yaml.test}.ts |
| 004 | lefthook.yml · lefthook/test-exemptions.txt · scripts/require-test-in-commit.sh · commitlint.config.mjs · package.json racine · tools/ci/src/require-test-in-commit.test.ts |
| 005 | packages/{schemas,factories,testing}/** exclusivement |

## Dispatch
4 subagents Sonnet, prompts avec story + contraintes injectées, TDD rouge→vert avec preuves, contrat de sortie JSON obligatoire (worktree, branche, sha, red/green outputs, statut par critère). Max 3 retries par story puis BLOCKED.

## Après intégration
Fin de lot F0 → **Boucle 3** : fan-out panel (security-reviewer + test-coverage-checker + style-conformance) puis gate humain de sortie de vague (dont critères `INFRA-003[gate]` nécessitant le remote GitHub — prérequis humain rappelé).

## Statuts
- INFRA-002/003/004/005 : TODO → **IN_PROGRESS**
