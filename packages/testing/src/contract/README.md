# contract — Harness

## Ce que cette suite garantit (règles T4–T7)

Cette suite valide la **conformité du contrat OpenAPI** via Schemathesis.
Elle invoque l'image Docker officielle schemathesis/schemathesis pour les tests de contrat.

### Règles couvertes

- **T4** — Toutes les routes exposées respectent le contrat OpenAPI déclaré.
- **T5** — Schemathesis est invoqué via Docker — pas de contournement de la validation.
- **T6** — En l'absence de contrat (F0), sortie propre code 0 + message SKIP.
- **T7** — En l'absence de Docker, échec propre avec message explicite.

### Harness disponible

- `runSchemathesis(options)` — Invoque Schemathesis via Docker.
  - `contractPath` — Chemin vers le YAML OpenAPI (undefined = mode SKIP).
  - `dockerPath` — Chemin Docker personnalisé (injection pour tests).
  - Retourne `{ exitCode, output }`.

### Script shell

`run-schemathesis.sh [chemin/contract.yaml]`
- Sans argument : exit 0 + "SKIP: aucun contrat OpenAPI — voir CONTRACT-009"
- Sans Docker : exit 1 + message explicite
- Avec YAML : invoque schemathesis/schemathesis via docker run

### Hors scope ici

L'exécution réelle contre un contrat métier est couverte en CONTRACT-009 (F1).
