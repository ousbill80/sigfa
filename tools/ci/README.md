# @sigfa/ci — Outils d'intégration continue

Outils CI du monorepo SIGFA : ratchet de couverture, validation du commit hook, smoke tests Docker.

## Modules

### `coverage-ratchet.ts`

Lit les rapports `coverage-final.json` au format istanbul, les fusionne, et compare les métriques globales avec la baseline `coverage-baseline.json` à la racine du monorepo.

Règles :
- Aucune des 4 métriques (lines, statements, branches, functions) ne doit baisser de plus de 0,1 point.
- En contexte `pull_request` avec `newFiles` : chaque nouveau fichier doit atteindre ≥85% statements.
- Si toutes les métriques s'améliorent de plus de 0,1 point, la baseline est automatiquement régénérée dans `artifactDir`.

### `require-test-in-commit.sh` (via `scripts/`)

Hook pre-commit vérifiant que tout fichier source modifié dispose d'un test dans le même commit. Exempte les barrels, les migrations, les fichiers générés et les fichiers de configuration (voir `lefthook/test-exemptions.txt`).

## Variable d'environnement : `SKIP_DOCKER_TESTS`

**Impact direct sur la mesure de couverture.**

Quand `SKIP_DOCKER_TESTS=1`, les suites suivantes sont sautées :

| Suite | Fichier | Raison du skip |
|---|---|---|
| `INFRA-002: images présentes + up -d postgres redis → healthy < 60s` | `check-dev-env.test.ts` | Nécessite Docker + images téléchargées |
| `INFRA-002: down puis up sans -v → données conservées` | `check-dev-env.test.ts` | Nécessite un volume persistant |
| `INFRA-002: POSTGRES_PORT surchargé via .env → service écoute sur le nouveau port` | `check-dev-env.test.ts` | Nécessite Docker |
| `INFRA-002: check-dev-env.sh vert sur environnement nominal, rouge si service down` | `check-dev-env.test.ts` | Nécessite les services actifs |

Ces suites couvrent des chemins de code dans `check-dev-env.sh` et la logique `composeCmd`.
**En conséquence, la couverture globale mesurée avec `SKIP_DOCKER_TESTS=1` est inférieure à la couverture réelle** : les métriques branches et statements sont sous-estimées d'environ 5 à 10 points selon l'état des services.

La baseline `coverage-baseline.json` à la racine est calculée **avec Docker actif** (sans SKIP).
Ne pas utiliser `SKIP_DOCKER_TESTS=1` pour recalculer la baseline.

## Lancer les tests

```bash
# Avec Docker (mesure de couverture complète)
pnpm --filter @sigfa/ci test

# Sans Docker (CI légère, couverture partielle)
SKIP_DOCKER_TESTS=1 pnpm --filter @sigfa/ci test
```
