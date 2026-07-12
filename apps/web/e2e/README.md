# RT-003 — E2E Playwright (parcours réels + coupure réseau)

E2E navigateur contre un **backend RÉEL** (API `REALTIME_MODE=real` + PostgreSQL 16
+ Redis 7 via Testcontainers). Aucun mock : sockets et API réels.

## Lancer

```bash
# Docker doit être démarré (Testcontainers PG16 + Redis7).
pnpm --filter @sigfa/web test:e2e          # exécute la suite
pnpm --filter @sigfa/web test:e2e:report   # ouvre le rapport HTML
```

## Orchestration (`support/global-setup.ts`)

Contrairement au `webServer` Playwright standard (qui démarrerait l'app AVANT de
connaître l'URL de l'API réelle), l'ordre est piloté manuellement :

1. **Testcontainers** PG16 + Redis7 → schéma (parité harnais intégration API-003)
   + seed (banque/agence/service/file/guichet/agent/borne). Voir `support/harness.ts`.
2. **Serveur API réel** (`apps/api/dist/index.js`) en sous-process, `REALTIME_MODE=real`,
   branché sur les conteneurs. Lancé via `support/api-launcher.mjs` qui :
   - enregistre un hook ESM (`support/src-resolver.mjs`) mappant les specifiers
     `src/*` compilés vers `apps/api/dist/*` ;
   - appelle explicitement `startServer()` (le garde `argv[1] === import.meta.url`
     de `index.js` ne déclenche pas sur un chemin contenant des espaces — macOS).
   - **Prérequis** : `pnpm --filter @sigfa/api build` (dist présent).
3. **App web Next** en sous-process (`next dev`), `NEXT_PUBLIC_API_URL` → API réelle
   (`/api/v1`), `NEXT_PUBLIC_REALTIME_MODE=real`, `NEXT_PUBLIC_AGENT_COUNTER_ID`
   injecté depuis le seed.
4. État (fixtures + URLs + token agent) persisté dans `.e2e-state.json`, relu par
   les specs (workers Playwright = process séparés).

`support/global-teardown.ts` arrête tout (web → api → conteneurs).

## Authentification

- `/tv` et `/agent` : le layout serveur lit le cookie httpOnly `access_token`,
  en dérive `agencyId` (scope JWT) et injecte token/agencyId/mode dans le
  `SocketProvider`. Les specs posent ce cookie via `context.addCookies`.
- Les appels authentifiés de l'agent passent par le proxy same-origin
  `/api/rt/*` (route handler Next) qui injecte le Bearer httpOnly et relaie vers
  `/api/v1/*` — le token n'est jamais exposé au JS client (C1, aucun fetch hors
  contrat).

## Stabilité

Attentes robustes (`toPass`, poll), timeouts généreux, retries en CI. La suite
tourne en `workers: 1` (backend réel partagé, état DB mutable). Voir
`playwright.config.ts`.
```
