# INFRA-002 : Docker Compose dev — postgres16 + redis7 + api + web + kiosk

**Module** : F0 — Fondations · **Agent** : direct (agent unique infra) · **Dépend de** : INFRA-001 · **Statut** : TODO
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)

## Exigences (EARS)

- Le système doit fournir un `docker-compose.yml` à la racine définissant `postgres` (image `postgres:16`) et `redis` (image `redis:7`), chacun avec **healthcheck** (`pg_isready` / `redis-cli ping`), volume nommé persistant, et port exposé configurable par variable d'environnement.
- QUAND `docker compose up -d postgres redis` est exécuté **avec les images déjà tirées localement**, les deux services doivent atteindre l'état `healthy` en moins de 60 secondes. Le pull initial des images est un **prérequis d'installation** (procédure de pull unique documentée dans le README dev — terrain CI : connexions instables, jamais compté dans le critère de délai).
- Le système doit définir les services applicatifs dev : image `node:22-slim`, `working_dir` sur le monorepo bind-monté (hot reload), `command: pnpm --filter @sigfa/<app> dev` (le placeholder HTTP d'INFRA-001), `depends_on` avec `condition: service_healthy` sur postgres et redis, variables injectées depuis `.env` — **aucun Dockerfile en F0**, aucun secret en dur dans le compose.
- Le système doit ajouter à `.env.example` (seule story de la vague autorisée à le modifier après INFRA-001) les variables commentées avec défauts dev : `POSTGRES_PORT=5432`, `POSTGRES_DB=sigfa`, `POSTGRES_USER=sigfa`, `POSTGRES_PASSWORD=sigfa` (dev uniquement), `REDIS_PORT=6379`, `API_PORT=3001`, `WEB_PORT=3000`, `KIOSK_PORT=3002`.
- SI un port par défaut est occupé, ALORS le développeur doit pouvoir surcharger chaque port via `.env` sans modifier `docker-compose.yml`.
- QUAND `docker compose down` puis `up -d` sont exécutés (sans `-v`), les données PostgreSQL et Redis doivent être conservées (volumes nommés).
- Le système doit fournir `scripts/check-dev-env.sh` validant : compose valide, services healthy, `SELECT 1` sur postgres, `PING` sur redis — **testé via Vitest + execa** (fichier de test dans `tools/ci/src/`, périmètre propre à cette story).

## Critères d'acceptation

- [ ] `INFRA-002: docker compose config valide (exit 0), zéro warning`
- [ ] `INFRA-002: images présentes + up -d postgres redis → healthy < 60s, pg_isready OK, redis PING → PONG`
- [ ] `INFRA-002: down puis up sans -v → une donnée écrite avant le down est toujours lisible`
- [ ] `INFRA-002: POSTGRES_PORT surchargé via .env → le service écoute sur le nouveau port`
- [ ] `INFRA-002: grep du compose → zéro secret littéral hors interpolation ${...} ; défauts uniquement dans .env.example`
- [ ] `INFRA-002: compose config atteste — services api/web/kiosk sur node:22-slim, bind mount, depends_on service_healthy, command pnpm --filter dev`
- [ ] `INFRA-002: check-dev-env.sh vert sur environnement nominal, rouge avec message clair si un service est down (suite Vitest+execa)`
- [ ] `INFRA-002: .env.example enrichi des 8 variables ci-dessus, chacune commentée`

## Hors scope de cette story

- Dockerfiles (dev comme prod) — F0 tourne sur image node:22-slim brute ; les images optimisées sont une story de déploiement
- CI GitHub Actions (INFRA-003) — la CI utilise Testcontainers, pas ce compose
- PgBouncer, read replica, tuning (SEC-004 / production)
- Contenu réel des apps (le placeholder HTTP vient d'INFRA-001 ; le vrai code arrive en F3/F4)
- Service mobile (Expo tourne hors Docker par nature)
- Migrations et seed de la base (DB-003)
- Miroir de registre Docker pour agences à connectivité faible (documenté README, outillage éventuel en story déploiement)
