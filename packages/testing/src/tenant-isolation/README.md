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
