# VAGUE F4 — CLIENTS SUR MOCK · DAG

> Le gain API-First : F4 code contre les mocks Prism (`pnpm --filter @sigfa/contracts mock`, ports MOCK_*) via le client `@sigfa/contracts` — ZÉRO attente de F3. La bascule mock→réel = RT-001 (une variable d'env). Statuts : `TODO → … → DONE | BLOCKED`

**Révision** : v2 — arbitrage 19

```
CONTRACT-009 (mocks) ─┬─► KIOSK-001 → 002 → 003 → 004 → 005 → {007, 008, 009}        (agent-kiosk)
  + CONTRACT-012       │                              └─────────► 006 (parallèle à 005, dépend de 004)
                      ├─► TV-001 → TV-002  [CONTRACT-012 prérequis de TV-002]          (agent-web)
                      ├─► WEB-001 → {WEB-002, WEB-003 → WEB-004 → WEB-005, WEB-006}   (agent-web)
                      └─► MOB-001 → MOB-002 → MOB-003 → {MOB-004, MOB-005}            (agent-mobile)

CONTRACT-012 est prérequis de : KIOSK-007, TV-002
```
**Parallélisation** : les 4 pistes (kiosk / tv+web / mobile) sont indépendantes (apps distinctes) → jusqu'à 3 agents en parallèle EN WORKTREES (un par app), intégration séquentielle par l'orchestrateur. À L'INTÉRIEUR d'une piste : séquentiel.
**TV et WEB partagent apps/web ?** NON — décision : l'écran TV est une ROUTE de apps/web (`/tv/:agencyId`, plein écran) — TV-001/002 sont des stories agent-web dans la piste web, séquencées avec elle.

## Conventions communes F4
- **Aucun fetch hors contrat** (C1) : tout accès réseau passe par le client typé `@sigfa/contracts` pointé sur `MOCK_*_PORT` (env `NEXT_PUBLIC_API_URL`/équivalent) — le security-reviewer rejette tout fetch sauvage.
- **Design system = LA LOI visuelle** : tokens uniquement (`docs/SIGFA_DESIGN_SYSTEM.md`), 5 états par écran (nominal/loading/empty/error/offline), i18n 4 langues (icône+texte appariés), kiosque ≥72 px/24 px/7:1.
- **Gate d'ORCHESTRATEUR** (PRD règle 5) : KIOSK-002..005, TV-001, WEB-002, WEB-003 — l'implémentation d'un écran gaté n'est dispatchée qu'APRÈS GO wireframe humain dans la session (mécanisme exécutoire = séquencement du dispatch par l'orchestrateur, pas un label) ; l'agent livre le wireframe ASCII + inventaire d'états en début de story et attend le GO avant de coder.
- Temps réel en F4 : les événements Socket.io sont SIMULÉS (fixtures du contrat realtime.ts — Prism ne mocke pas les sockets) ; branchement réel = RT-001/002. Mobile : polling du suivi public (cache 30 s) en attendant.
- Tests : Testing Library (web/kiosk) / Jest+RNTL (mobile), tests nommés `STORY-xxx:`, états offline testés (suite offline-resilience pour kiosk/mobile), régression visuelle par screenshots commités pour les écrans DESIGN-gatés (×4 langues pour KIOSK-005).
- Frameworks installés ICI (différé F0) : Next.js 15 (web), Next.js 15 + Electron 28 (kiosk), Expo SDK 51 (mobile — stratégie node-linker À TRANCHER dans MOB-001, contrainte consignée F0).

| Piste | Stories | Agent | Statut |
|---|---|---|---|
| Kiosque | KIOSK-001..009 | agent-kiosk | TODO (arbitrage v2 appliqué) |
| TV + Dashboards | TV-001..002, WEB-001..006 | agent-web | TODO (arbitrage v2 appliqué) |
| Mobile | MOB-001..005 | agent-mobile | DONE |

## Décisions d'arbitrage pré-critiques (issues des notes rédacteurs)
- **MOB-001 node-linker** : option retenue = `node-linker=hoisted` scopé ? NON — `.npmrc` racine est global au monorepo (risque sur les autres workspaces). Décision : **metro.config.js** (watchFolders + extraNodeModules) d'abord ; si échec documenté en story → bascule hoisted avec gate orchestrateur.
- **MOB-002 OTP** : sur mock, code fixe `123456` via fixtures — l'OTP réel arrive avec F6 (NOTIF-002) ; consigné dans la story (RT-001 n'activera PAS l'auth téléphone réelle avant F6).
- **MOB-003 Live Activity iOS** : module natif hors Expo Go — critère ramené à « notification persistante Android + structure Live Activity derrière flag, activation EAS = story pilote » (pas de dépendance à un build natif en F4).
- **Sockets mobile** : polling en F4 (contrat cache 30 s), sockets en RT-001.
- **TV auth** : l'écran TV utilise le mécanisme de session borne (credentials kiosk-access d'un « kiosk » de type affichage) — lecture seule, aucun nouveau contrat.
- **KIOSK-007 « erreur système »** : type d'alerte manquant au contrat → candidat CONTRACT-012 (`KIOSK_SYSTEM_ERROR` dans alert:manager) — à grouper avec les besoins des critiques.
- **KIOSK-009 feedback post-offline** : la note n'est proposée QUE si le ticket est synchronisé (trackingId serveur connu) ; sinon écran de remerciement sans note.
- **KIOSK-007 « file longue »** : seuil dérivé = estimatedWaitMinutes > 2× SLA du service (aucune nouvelle config).
- **WEB-004 carte** : SVG statique Côte d'Ivoire (zéro dépendance externe, offline-friendly).
- **WEB-005** : token `--scale-tv: 1.5` adopté (nommage proposé, à entériner au design-gate).
- **Événements simulés F4** : MSW/fixtures depuis realtime.ts — le SocketProvider du shell reste inactif jusqu'à RT-001 (frontière : F4 n'ouvre JAMAIS de connexion socket réelle).

## Gate de sortie de vague
Chaque app démarre contre le mock et déroule son parcours complet en E2E local (Playwright web/kiosk, Maestro ou RNTL flows mobile) · suites offline kiosk/mobile PASS · design-gates validés · zéro fetch hors contrat (revue) · CI verte.
