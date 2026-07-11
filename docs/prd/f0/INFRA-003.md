# INFRA-003 : CI GitHub Actions — lint → typecheck → test → build + ratchet de couverture

**Module** : F0 — Fondations · **Agent** : direct (agent unique infra) · **Dépend de** : INFRA-001 · **Statut** : TODO
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)
**Prérequis humain** : dépôt git initialisé + remote GitHub avec Actions activées (à fournir avant intégration — voir `_dag.md`).

## Exigences (EARS)

- Le système doit fournir `.github/workflows/ci.yml` exécutant **lint → typecheck → test → build** en jobs chaînés par `needs`, arrêt au premier échec — aucun job aval ne démarre si l'amont est rouge.
- QUAND un push ou une pull request cible `main` ou `staging`, la CI doit se déclencher.
- Le système doit mettre en cache le store pnpm et le cache Turborepo ; QUAND un second run s'exécute sans changement de dépendances, l'installation doit être restaurée du cache (log de restauration visible).
- **Ratchet de couverture (T2)** — porté par `tools/ci/src/coverage-ratchet.ts` (workspace créé par INFRA-001), code testé comme le reste :
  - La baseline est `coverage-baseline.json` à la racine, format `{ "global": { "lines": n, "statements": n, "branches": n, "functions": n } }`, valeurs en % à 2 décimales, calculées par **fusion des rapports `coverage-final.json` (Vitest v8) de tous les workspaces** via `istanbul-lib-coverage`.
  - SI l'une des 4 métriques mesurées est inférieure à la baseline de plus de 0,1 point, ALORS le job `test` échoue avec le delta par métrique.
  - QUAND la couverture monte, le run reste vert ; le script écrit la baseline régénérée en **artefact de run** et affiche sur stdout le message actionnable `baseline améliorée — commitez coverage-baseline.json` (la mise à jour est un commit volontaire ; jamais de mise à jour silencieuse, jamais de rouge sur une amélioration).
- **Règle des nouveaux fichiers (≥85%)** : sur `pull_request`, le diff est calculé contre le merge-base (`github.event.pull_request.base.sha`) ; SI un nouveau fichier source est sous 85% de couverture, ALORS le job échoue en le nommant. Sur `push` main/staging, cette vérification par fichier est **sautée** (déjà appliquée sur la PR) — seul le ratchet global s'applique.
- Le runner doit disposer de Docker pour Testcontainers (PostgreSQL 16 + Redis 7 réels, T5) ; le test de validation vit dans le **périmètre propre de la story** : `tools/ci/src/docker-smoke.test.ts` (Testcontainers direct, `SELECT 1`) — INFRA-003 ne touche **aucun** fichier sous `packages/testing` (périmètre INFRA-005) ; ce smoke sera remplacé par la consommation du harness `@sigfa/testing` dans une story ultérieure.
- Les cas du ratchet (baisse, hausse, nouveau fichier sous seuil, diff vide, fichier supprimé) ont leurs tests Vitest dans le même commit (Test Total).

## Critères d'acceptation

Vérifiables localement par l'agent (DONE-ables) :
- [ ] `INFRA-003: actionlint sur ci.yml → zéro erreur`
- [ ] `INFRA-003: baisse simulée >0,1pt sur une métrique → ratchet rouge avec delta par métrique (test unitaire)`
- [ ] `INFRA-003: hausse simulée → exit 0 + baseline régénérée écrite + message actionnable sur stdout (test unitaire)`
- [ ] `INFRA-003: nouveau fichier simulé <85% → rouge le nommant ; contexte push → vérification sautée (tests unitaires)`
- [ ] `INFRA-003: fusion istanbul de ≥2 coverage-final.json de workspaces → total conforme au calcul attendu (test unitaire)`
- [ ] `INFRA-003: docker-smoke.test.ts — Testcontainers PostgreSQL 16 répond à SELECT 1 en local`
- [ ] `INFRA-003: la chaîne needs lint→typecheck→test→build est attestée par inspection du YAML (test qui parse ci.yml)`
- [ ] `INFRA-003: aucun fichier de packages/testing touché par le diff de la story`

Vérifiés au gate humain de sortie de vague (nécessitent le remote GitHub) :
- [ ] `INFRA-003[gate]: pipeline verte de bout en bout sur la PR de la story`
- [ ] `INFRA-003[gate]: échec injecté au lint → jobs aval non démarrés (run réel)`
- [ ] `INFRA-003[gate]: second run → caches pnpm et turbo restaurés (logs du run)`
- [ ] `INFRA-003[gate]: branch protection main/staging exigeant les 4 checks verts (config repo, vérifiable via gh api)`

## Hors scope de cette story

- `deploy.yml` (staging Railway / production — story de déploiement ultérieure)
- Détection automatisée des tests flaky — **INFRA-006, story différée consignée au backlog** (T8)
- Schemathesis et **diff de contrat OpenAPI en CI (C4)** — amendement proposé au PO : l'ajouter explicitement au périmètre de CONTRACT-009
- Suites tenant-isolation / offline dans la chaîne (branchées quand DB-002 / F4 existeront)
- Notifications d'échec (Slack/email) et badges
- Création du dépôt GitHub et de la branch protection elle-même (action humaine — prérequis, pas livrable d'agent)
