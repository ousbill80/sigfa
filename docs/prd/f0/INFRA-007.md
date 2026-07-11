# INFRA-007 : Corrections lot F0 — durcissement CI, ratchet, flaky ESLint, traçabilité T3 (issues panel Boucle 3)

**Module** : F0 — Fondations · **Agent** : direct · **Dépend de** : INFRA-001..004 (DONE) · **Statut** : TODO
**Origine** : findings panel (07-panel-f0-synthese.md) + premier run CI rouge.

## Exigences (EARS)

- Le job CI Test échoue actuellement : SI un test a une durée dépendante de l'environnement (API ESLint ~1–10 s), ALORS il doit porter un timeout explicite ≥30 s — corriger la suite `packages/config/src/eslint.test.ts` (T8 : flaky = P1).
- `ci.yml` doit déclarer `permissions: contents: read` au niveau workflow (surcharges par job si besoin), épingler chaque action tierce à son SHA de commit (commentaire `# vX.Y.Z`), et scoper les `restore-keys` du cache turbo par branche (`github.ref_name`).
- Le ratchet doit exclure les fixtures : `coverage.exclude: ['**/__fixtures__/**']` dans la base vitest de `packages/config`, puis `coverage-baseline.json` recalculée et commitée.
- QUAND la règle « nouveau fichier ≥85% » s'applique, les placeholders `apps/{api,web,kiosk}/src/index.ts` doivent l'atteindre (test du guard isMain ou `/* v8 ignore */` justifié par commentaire).
- Les tests portant les critères d'INFRA-001 doivent être renommés avec le préfixe `INFRA-001: ` (traçabilité T3) ; ajouter les assertions manquantes simples : `.env.example` contient l'en-tête + NODE_ENV ; `.gitignore` contient `.env`.
- Le critère commitlint d'INFRA-004 doit être testé EN EXÉCUTION : `commitlint --edit` sur « wip » → exit ≠0 ; sur « feat(api): émission ticket » → exit 0 (dans `tools/ci/src/require-test-in-commit.test.ts` ou fichier dédié).
- `runRatchet` (83 lignes) doit être découpé (<30 lignes par fonction, JSDoc) ; les constantes `xxxVersion` de `tools/ci` et `apps/*` renommées en UPPER_SNAKE_CASE.
- `docker-compose.yml` : bindings de ports préfixés `127.0.0.1:`.
- Documenter dans `tools/ci/README.md` (nouveau) l'effet de `SKIP_DOCKER_TESTS` sur la mesure de couverture.

## Critères d'acceptation
- [ ] `INFRA-007: suite eslint.test.ts avec timeout 30s — verte 3 exécutions consécutives`
- [ ] `INFRA-007: actionlint zéro erreur ; permissions contents:read ; zéro action sans SHA ; restore-keys scoped branche`
- [ ] `INFRA-007: ratchet vert en local avec fixtures exclues ; baseline recalculée commitée`
- [ ] `INFRA-007: apps placeholders ≥85% statements (rapport de couverture)`
- [ ] `INFRA-007: grep "INFRA-001:" dans packages/config et apps → ≥6 tests nommés ; assertions env/gitignore vertes`
- [ ] `INFRA-007: commitlint exécuté réellement — wip rejeté, feat accepté (2 tests)`
- [ ] `INFRA-007: aucune fonction >30 lignes dans tools/ci (vérif wc) ; constantes UPPER_SNAKE`
- [ ] `INFRA-007: compose bindings 127.0.0.1 ; suite check-dev-env toujours verte (Docker réel)`

## Hors scope
Corrections packages partagés (INFRA-008) · digests d'images (différé prod) · console.log placeholders (F3) · hook du kit .claude/ (gabarit).
