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
**En conséquence, la couverture globale mesurée avec `SKIP_DOCKER_TESTS=1` est inférieure à la couverture réelle** : les métriques branches et functions sont sous-estimées par rapport à un run local complet avec Docker.

## Politique de baseline (INFRA-007)

**La baseline `coverage-baseline.json` est mesurée en conditions CI (`SKIP_DOCKER_TESTS=1`).**

Le job CI (`pnpm test -- --coverage`) s'exécute dans un environnement où Docker n'est pas pleinement accessible pour les tests `check-dev-env`, ce qui revient au comportement `SKIP_DOCKER_TESTS=1` pour ces suites. La baseline reflète donc cette réalité.

Conséquence pour les développeurs : les runs locaux avec Docker complet dépassent naturellement la baseline sur les métriques `branches` et `functions` — c'est attendu et souhaitable. **Seules les baisses par rapport à la baseline CI comptent** pour le ratchet.

Pour recalculer la baseline (par exemple après une amélioration de couverture) :

```bash
# 1. Lancer les tests en conditions CI
SKIP_DOCKER_TESTS=1 pnpm turbo run test --force -- --coverage

# 2. Calculer les métriques fusionnées
node --input-type=module << 'EOF'
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { computeGlobalMetrics, mergeIstanbulReports } from './tools/ci/dist/coverage-ratchet.js';
const reports = [];
for await (const f of glob('**/coverage/coverage-final.json', { ignore: ['**/node_modules/**'] })) {
  reports.push(JSON.parse(readFileSync(f, 'utf-8')));
}
const metrics = computeGlobalMetrics(mergeIstanbulReports(reports));
console.log(JSON.stringify({ global: metrics }, null, 2));
EOF

# 3. Mettre à jour coverage-baseline.json à la racine du monorepo
# 4. Committer avec le message : fix(infra): recalcul baseline CI (SKIP_DOCKER_TESTS)
```

## Lancer les tests

```bash
# Avec Docker (mesure de couverture complète — dépasse la baseline, normal)
pnpm --filter @sigfa/ci test

# En conditions CI (mesure alignée avec la baseline)
SKIP_DOCKER_TESTS=1 pnpm --filter @sigfa/ci test
```
