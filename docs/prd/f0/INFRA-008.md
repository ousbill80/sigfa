# INFRA-008 : Corrections lot F0 — packages partagés (issues panel Boucle 3)

**Module** : F0 — Fondations · **Agent** : agent-database (périmètre étendu F0 : packages/{schemas,factories,testing,ui,database}) · **Dépend de** : INFRA-005 (DONE) · **Statut** : TODO
**Origine** : findings panel (07-panel-f0-synthese.md).

## Exigences (EARS)

- Les fonctions >30 lignes doivent être découpées (JSDoc, comportement inchangé — les tests existants restent verts sans modification d'assertions) : `createRealtimeHarness` (realtime-guarantees/harness.ts), `runSchemathesis` (contract/harness.ts), `startPostgresContainer` et `startRedisContainer` (tenant-isolation/harness.ts), `generateValue` (factories/zod-generator.ts).
- `packages/testing/src/contract/harness.ts` doit atteindre ≥85% de couverture statements (tester les branches non couvertes : YAML existant + docker factice succès/échec — sans exécuter le vrai Schemathesis).
- Les constantes `xxxVersion` des packages (`schemas`, `factories`, `testing`, `ui`, `database`, `contracts`, `config`) doivent passer en UPPER_SNAKE_CASE (tests ajustés dans le même commit).
- Le README de la suite tenant-isolation doit documenter pourquoi ses tests Testcontainers ne sont PAS derrière `SKIP_DOCKER_TESTS` (asymétrie volontaire avec check-dev-env).

## Critères d'acceptation
- [ ] `INFRA-008: aucune fonction >30 lignes dans packages/{testing,factories} (vérification comptée)`
- [ ] `INFRA-008: contract/harness.ts ≥85% statements (rapport couverture)`
- [ ] `INFRA-008: constantes UPPER_SNAKE dans les 7 packages, lint+typecheck+tests verts`
- [ ] `INFRA-008: README tenant-isolation documente l'asymétrie SKIP_DOCKER_TESTS`
- [ ] `INFRA-008: suites @sigfa/testing intégralement vertes (PG16+Redis réels)`

## Hors scope
Tout fichier hors packages/ · corrections infra/CI (INFRA-007) · remplissage métier des suites (F2+).
