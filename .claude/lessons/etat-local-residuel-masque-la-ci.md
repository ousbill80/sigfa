# Leçon — L'état local résiduel masque les échecs CI (classe promue, 2 occurrences)

**Date** : 2026-07-11 · **Classe** : environnement de vérification ≠ environnement d'exécution CI

## Occurrences
1. **INFRA-003/007** : l'étape ratchet importait `tools/ci/dist/` — existant en local (builds antérieurs), absent sur le runner (le job Build vient après Test). Baseline de couverture mesurée en local Docker complet vs CI qui skippe.
2. **F1 intégration** : `turbo.json` sans `typecheck.dependsOn: ["^build"]` — le typecheck de `@sigfa/contracts` résolvait `@sigfa/schemas` via des `dist/` résiduels locaux ; clone frais CI → TS2307.

## Règle
Tout gate local qui prétend prédire la CI doit être exécuté en **conditions CI reproduites** : `dist/` purgés, caches turbo vidés, mêmes variables d'env (`SKIP_DOCKER_TESTS`), `--force`. Toute tâche turbo qui consomme les types/artefacts d'un autre workspace déclare `dependsOn: ["^build"]`.

## Enforcement
- Test structurel `packages/config/src/inspect.test.ts` : `typecheck.dependsOn` contient `^build` (commit 2641221) ; idem pour la précédence build-avant-dist dans `ci-yaml.test.ts` (commit cfe25b0).
- Consigne d'orchestration : avant tout push de fin de vague, rejouer le gate après `find . -name dist -not -path '*/node_modules/*' -exec rm -rf {} +` et purge du cache turbo.
