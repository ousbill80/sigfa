# Session 2026-07-11 — Boucle 3 · Synthèse du panel adversarial F0 + premier run CI

**Verdicts** : security-reviewer → FINDINGS (3 MAJOR, 4 MINOR) · test-coverage-checker → FINDINGS (4 MAJOR, 3 MINOR, ratchet_ok=false, couverture globale 87%) · style-conformance → FINDINGS (7 MAJOR, 3 MINOR). **Aucun CRITICAL → pas de rollback.**
**Premier run CI réel (gate INFRA-003)** : lint ✓, typecheck ✓, **Test ✗** — `eslint.test.ts > flags explicit any` timeout 5 s sur runner GitHub (confirmé sur main ET staging). C'est le signal flaky anticipé par l'agent INFRA-003 → T8 : bug P1.

## Arbitrage des findings

| # | Source | Sév. | Finding | Décision | Portage |
|---|---|---|---|---|---|
| S1 | security | MAJOR | ci.yml sans bloc `permissions:` (moindre privilège) | **INTÉGRÉ** | INFRA-007 |
| S2 | security | MAJOR | Actions GitHub non épinglées à un SHA | **INTÉGRÉ** | INFRA-007 |
| S3 | security | MAJOR | restore-keys cache turbo sans composante de branche | **INTÉGRÉ** | INFRA-007 |
| S4/S7 | security | MINOR | Images docker (compose, schemathesis) sans digest | **REJETÉ-différé** — env de dev, tags majeurs voulus lisibles ; à réévaluer au durcissement prod (SEC-003/004) | backlog |
| S5 | security | MINOR | Ports compose liés à 0.0.0.0 | **INTÉGRÉ** (préfixe 127.0.0.1) | INFRA-007 |
| S6 | security | MINOR | Quoting `$SRC` dans le hook du kit `.claude/hooks/` | **NOTÉ** — le script réellement actif (`scripts/require-test-in-commit.sh`, INFRA-004) est correctement quoté ; le hook du kit est un gabarit | backlog kit |
| C1 | coverage | MAJOR | Ratchet FAIL : fixtures `__fixtures__/` comptées (functions 100→92,16) | **INTÉGRÉ** (exclude + recalcul baseline) | INFRA-007 |
| C2 | coverage | MAJOR | Nouveaux fichiers <85% : apps placeholders (guard isMain), contract/harness.ts 51% | **INTÉGRÉ** | INFRA-007 (apps) / INFRA-008 (harness) |
| C3 | coverage | MAJOR | T3 : aucun test préfixé `INFRA-001:` (traçabilité) | **INTÉGRÉ** | INFRA-007 |
| C4 | coverage | MAJOR | Critère commitlint couvert « de nom seulement » (jamais exécuté) | **INTÉGRÉ** (test exécutant commitlint --edit réel) | INFRA-007 |
| C5 | coverage | MINOR | `something.ts` sans test (commit historique INFRA-001) | **NOTÉ** — déjà consigné au rapport 04 ; le hook T1 actif rend la récidive impossible | clos |
| C6/C7 | coverage | MINOR | Impact SKIP_DOCKER_TESTS sur la mesure + asymétrie skipIf | **INTÉGRÉ** (documentation) | INFRA-007/008 |
| C8 | coverage | — | Critères INFRA-001 « processus » non mappés à des tests (install à froid, FULL TURBO…) | **REJETÉ avec justification** : critères de processus d'exécution, vérifiés par l'orchestrateur au gate (preuves dans les rapports de session) et par la CI elle-même — un test unitaire qui relance pnpm install serait un méta-test fragile. Exceptions intégrées : assertions .env.example/.gitignore (INFRA-007) | — |
| ST1-6 | style | MAJOR | 6 fonctions >30 lignes (ratchet, harness realtime/contract/tenant ×2, zod-generator) | **INTÉGRÉ** | INFRA-007 (ratchet) / INFRA-008 (harness+factories) |
| ST7 | style | MAJOR | Constantes `xxxVersion` en camelCase au lieu d'UPPER_SNAKE | **INTÉGRÉ** | INFRA-007 (apps+tools) / INFRA-008 (packages) |
| ST8-10 | style | MINOR | console.log dans les placeholders apps | **REJETÉ-différé F3** — squelettes sans framework, Pino arrive avec l'API réelle | F3 |
| CI-1 | run réel | **P1** | Flaky : eslint.test.ts timeout 5 s sur runner (T8) | **INTÉGRÉ** (timeout explicite 30 s sur la suite ESLint) + leçon si récidive d'une classe similaire | INFRA-007 |

## Stories de correction créées (mini-Boucle 2)
- **INFRA-007** (`docs/prd/f0/INFRA-007.md`) — corrections infra/CI : agent direct, worktree
- **INFRA-008** (`docs/prd/f0/INFRA-008.md`) — corrections packages partagés : agent-database, worktree
Intégration séquentielle 007 → 008 après retour, gates rejoués, re-push → le run CI re-vérifie `INFRA-003[gate]`.
