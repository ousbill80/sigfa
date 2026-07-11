# tenant-isolation — Harness

## Ce que cette suite garantit (règles T4–T7)

Cette suite valide l'**isolation stricte des données par tenant (banque)** dans SIGFA.
Elle utilise des conteneurs éphémères réels via Testcontainers — jamais de mock (règle T5).

### Règles couvertes

- **T4** — Aucune donnée d'un tenant ne doit être accessible à un autre tenant.
- **T5** — Les tests d'intégration utilisent des vraies bases de données (PostgreSQL 16, Redis 7).
- **T6** — Les connexions sont vérifiées par des requêtes réelles (SELECT 1, PING).
- **T7** — Les conteneurs sont démarrés et arrêtés proprement autour de chaque suite.

### Harness disponible

- `startPostgresContainer()` — Démarre PostgreSQL 16, retourne { query, stop, connectionString }.
- `startRedisContainer()` — Démarre Redis 7, retourne { ping, stop, connectionUrl }.

### Hors scope ici

Les données réelles tenant-isolation (bank_id, RLS) sont couvertes en DB-002.

---

## Asymétrie SKIP_DOCKER_TESTS

Les tests de cette suite démarrent de vrais conteneurs Docker (PostgreSQL, Redis) via Testcontainers.
Ils peuvent être coûteux en temps et nécessitent Docker disponible sur la machine de CI.

### Comportement selon l'environnement

| Environnement | Comportement |
|---|---|
| CI avec Docker | Les deux harnesses démarrent et les vérifications (SELECT 1, PING) s'exécutent |
| Machine sans Docker | Les tests échouent avec une erreur Testcontainers explicite |
| `SKIP_DOCKER_TESTS=true` | **Non supporté ici** — la suite tenant-isolation exige des conteneurs réels (règle T5) |

### Pourquoi pas de SKIP pour tenant-isolation ?

Contrairement au harness `contract/` qui émet un résultat `SKIP` en l'absence de contrat YAML,
la suite `tenant-isolation` ne propose **pas** de mode SKIP.

La raison est intentionnelle : l'isolation tenant est une propriété de sécurité critique (règle T4).
Un environnement sans Docker doit faire échouer la suite explicitement, pas la contourner silencieusement.

Si vous avez besoin d'exclure ces tests en CI, utilisez le filtre Vitest :
```sh
vitest run --ignore='**/tenant-isolation/**'
```
et documentez pourquoi l'isolation tenant n'est pas vérifiée dans ce pipeline.
