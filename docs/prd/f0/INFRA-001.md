# INFRA-001 : Monorepo pnpm + Turborepo — squelette apps/ + packages/ + configs partagées

**Module** : F0 — Fondations · **Agent** : direct (agent unique infra) · **Dépend de** : — (racine absolue) · **Statut** : TODO
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)

## Exigences (EARS)

- Le système doit fournir un monorepo **pnpm 10 workspaces + Turborepo 2.x** (clé `tasks` dans `turbo.json`, turbo `^2` épinglé en devDependency racine) contenant les workspaces `apps/{api,web,kiosk,mobile}`, `packages/{contracts,schemas,ui,config,database,factories,testing}` et `tools/ci`, chacun nommé `@sigfa/<nom>` dans son `package.json`.
- Squelettes **TypeScript pur — aucun framework lourd en F0** (Hono/Next.js/Electron/Expo arrivent avec F3/F4) :
  - packages et `apps/mobile` : point d'entrée `src/index.ts` exporté, `build` = `tsc`, `typecheck` = `tsc --noEmit` ;
  - `apps/{api,web,kiosk}` : `src/index.ts` + tâche `dev` servant un placeholder HTTP 200 `SIGFA <app> skeleton` via `node:http` (zéro dépendance), port lu depuis l'environnement.
- Le système doit centraliser dans `packages/config` : bases `tsconfig` (`strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`), **ESLint 9 flat config** (chaque workspace fait `import base from '@sigfa/config/eslint'`) interdisant `any` explicite et `@ts-ignore`, config Prettier, et **base `vitest.config`** (provider de couverture `v8`, reporter `coverage-final.json`) étendue par chaque workspace — jamais de copie locale divergente.
- Le système doit configurer les **imports absolus depuis `src/`** (`baseUrl`/`paths`) ; tout import parent (`../` — un niveau ou plus) doit être rejeté par la règle `import/no-relative-parent-imports` ; les imports même-dossier `./` restent permis.
- QUAND `pnpm turbo run lint typecheck test build` est exécuté à la racine, le système doit exécuter chaque tâche selon le graphe `turbo.json` (`build` dépend de `^build` ; `test` dépend de `^build` **uniquement** — jamais du build du workspace courant, pour préserver l'itération TDD) et s'arrêter au premier échec.
- QUAND une tâche Turborepo est ré-exécutée sans changement de fichier, le système doit la servir intégralement du cache (« FULL TURBO », 0 tâche ré-exécutée).
- Le système doit imposer les versions : `.nvmrc` = `22`, `engines` = `{ "node": ">=22 <23", "pnpm": ">=10 <11" }`, `packageManager` = `pnpm@10.30.3` (version du poste de dev, épinglée exacte — amendement post-critique : le poste tourne pnpm 10, la spec SETUP.md disait 9), Vitest `^3` ; SI Node ou pnpm est hors plage, ALORS `pnpm install` doit échouer avec message explicite (`engine-strict=true` dans `.npmrc`).
- Le système doit créer `.env.example` à la racine (en-tête de convention + `NODE_ENV=development` commentée — chaque story ultérieure ajoute SES variables ; pendant la vague F0, seul INFRA-002 le modifie) et ignorer `.env` dans `.gitignore` ; UBIQUITAIRE : aucun secret ni valeur d'environnement en dur.
- Chaque workspace squelette doit naître avec **au moins un test Vitest** (smoke : le point d'entrée s'importe et exporte ce qui est déclaré) — Test Total dès le squelette (T1).
- **Propriété des fichiers de couture** : après INFRA-001, le `package.json` racine et `pnpm-lock.yaml` ne sont modifiés par les stories suivantes que via l'**intégration séquentielle** orchestrée (voir `_dag.md`) — jamais par deux agents concurrents.

## Critères d'acceptation

- [ ] `INFRA-001: pnpm install à froid sur Node 22 réussit (exit 0), lockfile commité, zéro framework lourd (ni next ni electron ni expo dans le lockfile)`
- [ ] `INFRA-001: pnpm turbo run lint typecheck test build passe sur les 12 workspaces squelettes`
- [ ] `INFRA-001: un any explicite ou un @ts-ignore fait échouer turbo run lint`
- [ ] `INFRA-001: import '../foo' échoue au lint (un seul niveau suffit) ; import 'src/foo' passe ; import './foo' passe`
- [ ] `INFRA-001: seconde exécution de turbo run build sans changement → 100% cache hits (FULL TURBO)`
- [ ] `INFRA-001: sous Node hors >=22<23 ou pnpm hors >=10<11, pnpm install échoue avec message explicite`
- [ ] `INFRA-001: chaque workspace possède ≥1 test smoke vert ; aucun workspace sans test`
- [ ] `INFRA-001: la tâche dev de apps/{api,web,kiosk} répond 200 "SIGFA <app> skeleton" sur son port d'environnement`
- [ ] `INFRA-001: .env.example présent (en-tête + NODE_ENV), .env dans .gitignore, zéro secret dans le repo`
- [ ] `INFRA-001: turbo.json — test ne dépend pas du build du workspace courant (inspection du graphe turbo)`

## Hors scope de cette story

- Docker Compose et services d'infrastructure (INFRA-002)
- CI GitHub Actions et ratchet de couverture (INFRA-003) — mais le workspace `tools/ci` (vide hormis squelette) est créé ici
- Hooks git lefthook/commitlint (INFRA-004) — y compris le script `prepare` (ajouté par INFRA-004 à l'intégration)
- Contenu réel de `@sigfa/schemas`, `@sigfa/factories`, `@sigfa/testing` (INFRA-005)
- **Installation des frameworks** Hono/Next.js/Electron/Expo — différée à F3/F4 (décision d'arbitrage : fragilité réseau terrain CI + aucun besoin pour le gate F0) ; la stratégie pnpm `node-linker` pour Expo/Metro est une contrainte consignée pour MOB-001
- `packages/contracts` : structure de dossiers uniquement (`openapi/`, `events/`, `generated/`) — contenu en F1
