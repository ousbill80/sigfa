# Leçon — L'état local résiduel masque les échecs CI (classe promue, 3 occurrences)

**Date** : 2026-07-11 · **Classe** : environnement de vérification ≠ environnement d'exécution CI

## Occurrences
1. **INFRA-003/007** : l'étape ratchet importait `tools/ci/dist/` — existant en local (builds antérieurs), absent sur le runner (le job Build vient après Test). Baseline de couverture mesurée en local Docker complet vs CI qui skippe.
2. **F1 intégration** : `turbo.json` sans `typecheck.dependsOn: ["^build"]` — le typecheck de `@sigfa/contracts` résolvait `@sigfa/schemas` via des `dist/` résiduels locaux ; clone frais CI → TS2307.
3. **CONTRACT-009b retry 1/3** : Schemathesis (conteneur Docker) cible `http://host.docker.internal:<port>` — sur runner Linux, `host.docker.internal` ne résout pas (feature Docker Desktop macOS/Windows uniquement). En local macOS ça passe silencieusement. Fix : `--add-host=host.docker.internal:host-gateway` dans `docker run` — mappe `host-gateway` (l'IP du bridge Docker de l'hôte) sur Linux, no-op compatible sur Docker Desktop macOS. Appliqué dans `run-schemathesis.sh`, `harness.ts:invokeDocker`, et déjà présent dans `schemathesis-smoke.sh` et `mock-prism.test.ts`.
   **Complément (retry 2/3)** : même avec `host-gateway` correctement résolu, les connexions depuis le conteneur arrivent sur l'IP du bridge Docker (ex. `172.17.0.1`), **pas** sur `127.0.0.1`. Prism démarré avec `--host 127.0.0.1` (défaut ou codé en dur) refuse ces connexions → "Connection refused" en CI Linux, mais pas sur macOS Docker Desktop où `host.docker.internal` atteint la loopback de l'hôte. Fix : dans tout contexte où Schemathesis tourne en conteneur, Prism doit binder sur `0.0.0.0` (`--host 0.0.0.0`) pour accepter les connexions depuis toutes les interfaces. Appliqué via `PRISM_SCHEMATHESIS_HOST=0.0.0.0` dans `mock-prism.test.ts` et `PRISM_HOST` dans `schemathesis-smoke.sh`. Le script dev `mock.mjs` conserve `127.0.0.1` par défaut via `PRISM_HOST` env (ne pas exposer sur le LAN).

## Règle
Tout gate local qui prétend prédire la CI doit être exécuté en **conditions CI reproduites** : `dist/` purgés, caches turbo vidés, mêmes variables d'env (`SKIP_DOCKER_TESTS`), `--force`. Toute tâche turbo qui consomme les types/artefacts d'un autre workspace déclare `dependsOn: ["^build"]`.

## Enforcement
- Test structurel `packages/config/src/inspect.test.ts` : `typecheck.dependsOn` contient `^build` (commit 2641221) ; idem pour la précédence build-avant-dist dans `ci-yaml.test.ts` (commit cfe25b0).
- Consigne d'orchestration : avant tout push de fin de vague, rejouer le gate après `find . -name dist -not -path '*/node_modules/*' -exec rm -rf {} +` et purge du cache turbo.
