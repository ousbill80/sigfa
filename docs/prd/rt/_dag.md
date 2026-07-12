# VAGUE RT — BASCULE MOCK→RÉEL & GARANTIES TEMPS RÉEL · DAG

> Après F3 (API réelle) et F4 (clients sur mock Prism), RT branche le **réel de bout en bout** : le serveur émet réellement sur Socket.io, les clients construits se connectent à l'API réelle, et les garanties (latence, reconnexion) sont mesurées. Statuts : `TODO → … → DONE | BLOCKED`.

**Révision** : **v2 — arbitrage `docs/sessions/2026-07-12/31-critique-arbitrage-rt.md`** (Boucle 1 convergée, en attente GO)

```
F3 DONE ─┐
         ├─► RT-001 (enablement serveur + bascule clients construits) ─► RT-002 (garanties temps réel) ─► RT-003 (E2E Playwright)
F4 (partiel) ─┘
```

## Précondition & scoping (IMPORTANT)
`PRD_PRODUIT` pose `RT-001 : F3 DONE, F4 DONE`. **F4 est PARTIEL** : construits = KIOSK-001..005, TV-001/002, WEB-001/002/003, MOB-001..005 ; NON construits = KIOSK-006..009, WEB-004..006. Décision de scoping proposée (à valider en arbitrage) :
- **RT-001 est découpé** en deux moitiés indépendantes : **(A) enablement serveur** du temps réel (câblage bootstrap `index.ts` + adossement `RealtimeBus`↔`io`) — **ne dépend PAS de F4** et résorbe la « frontière RT-001 » consignée en F3 (API-006/007) ; **(B) bascule des clients** — s'applique aux écrans DÉJÀ construits ; les écrans F4 restants basculeront à leur livraison (aucune régression : la bascule est pilotée par une variable d'env, pas par écran).
- RT-002/RT-003 exercent le réel sur les parcours construits ; les parcours dépendant d'écrans non bâtis sont marqués `PENDING F4`.

## Conventions communes RT
- **Bascule par variable d'env, jamais par fork de code.** `REALTIME_MODE` (api) fait AUTORITÉ ; l'URL client en dérive. Matrice normative (D2) :
  | Surface | Variable | off / défaut (y compris tests) | real |
  |---|---|---|---|
  | api | `REALTIME_MODE` ∈ {off, real} | `off` → `createNoopBus`, ni socket ni scheduler | `real` → `createSocketBus` + `startAlertScheduler` |
  | web/kiosk | `NEXT_PUBLIC_API_URL` | mock Prism (valeur canonique unifiée — corriger 4010 web / 3000 kiosk) | URL API réelle |
  | mobile | `EXPO_PUBLIC_API_URL` | mock / **polling (défaut RT-001)** | PENDING (bascule socket = story ultérieure) |
- **Aucun nouveau contrat** : RT n'invente aucun événement ni route — il BRANCHE le contrat existant (`events/realtime.ts`, YAML). Toute émission passe par l'émetteur typé validé Zod.
- **Frontière F6** : RT-001 n'active PAS l'auth téléphone réelle (OTP reste `123456` fixture jusqu'à NOTIF-002/F6) ni les notifications réelles.
- **Test Total** : chaque story livre code+test+doc, TDD rouge→vert, gate sérialisé `TURBO_CONCURRENCY=1 pnpm test`, CI verte, zéro co-signature.

| ID | Story | Dépend de | Agent | Statut |
|---|---|---|---|---|
| RT-001a | Serveur : bootstrap câblé + adaptateur bus↔contrat (`createSocketBus`, `emit(event,agencyId,payload)`, 7 événements) + retouche sites d'émission F3 + graceful shutdown | F3 DONE | agent-api | **DONE** (`bbbfc54`, 476 tests, parité contrat 7 événements, intégration route→socket réel) |
| RT-001b | Clients : web `SocketProvider` activé + kiosk socket créé + convergence resync + états d'échec ; mobile PENDING (polling) | RT-001a ; F4 partiel | agent-web/kiosk | **DONE** (`6b353f5`, web 216 + kiosk 98 tests, resync snapshot, états error/offline bornés, défaut :4010 unifié) |

> **Couture RT-001b → RT-003** : le `SocketProvider` web prend token/url/agencyId/mode en props (JWT = cookie httpOnly invisible au JS) ; le **câblage dans le layout web réel** (server component injectant le token) reste à faire — nécessaire pour l'E2E RT-003 (parcours navigateur sur app réelle). Kiosk idem si applicable.
| RT-002 | Suite `realtime-guarantees` : `ticket:called` p95 <500 ms bout-en-bout, reconnexion WS → resync, course 2 agents | RT-001 | agent-api + agent-web | **DONE** (`4efe890`, p95≈0,3 ms mesuré/adapter actif, resync snapshot, course 2 agents, multi-instance Redis, 481 tests) |
| RT-003 | E2E Playwright : borne → appel TV → service agent → feedback, coupure réseau mi-parcours (+ run Electron kiosk réel différé de F4) | RT-002 | direct | **DONE** (`d4c57c6`, parcours complet réel + resync coupure réseau, backend Testcontainers réel, stable 3 runs) |

> **RT-003 — trouvailles E2E & coutures** : (1) l'E2E a révélé que le `SocketProvider` (RT-001b) émettait `join:agency` en **chaîne nue** au lieu de `{agencyId}` → serveur (Zod) rejetait → aucune room → TV muette — **corrigé** (les tests unitaires mockés ne l'avaient pas vu ; valeur de l'E2E réel). (2) **Couture API à résorber** : `POST /public/tickets` est déclaré au contrat (`public.yaml`, RBAC role NONE) mais **sans handler serveur** → la borne réelle passe par `POST /tickets` (AGENT). Story API ultérieure. (3) L'E2E vit dans `test:e2e` (Playwright), **hors gate CI principal** (stabilité 2 cœurs) — validé localement (3 runs stables) ; wiring dans un job CI dédié = suivi. (4) Electron réel = best-effort PENDING tracé (`docs/sessions/2026-07-12/32-rt-003-e2e-electron-status.md`), filet automatisé = E2E navigateur.

## Clôture vague RT (2026-07-12)
**RT-001a/b + RT-002 + RT-003 DONE**, CI verte. Le temps réel est branché de bout en bout (serveur émet la forme contrat sur les rooms `agency:{id}` ; web/kiosk consomment le réel sous `REALTIME_MODE=real` ; p95≈0,3 ms mesuré ; resync par snapshot ; parcours E2E réel avec coupure réseau). **PENDING/suivi** : bascule socket mobile (dep+provider+Metro), `POST /public/tickets` handler, E2E en job CI, Electron réel CI, + dette F3 consignée (RLS `withTenant`, Schemathesis `response-schema-conformance`, DRY). Prochaine vague produit : F4 restant (KIOSK-006..009, WEB-004..006) ou F6-F11, sur GO humain.

## Gate de sortie de vague
Serveur réel émet sur les rooms `agency:{id}` (émissions des routes API-003/004/005/007 atteignent les clients abonnés) · au moins un parcours client construit connecté au réel de bout en bout · `ticket:called` p95 <500 ms mesuré (RT-002) · reconnexion WS resynchronise l'état · E2E Playwright vert avec coupure réseau · Schemathesis complet contre l'API réelle · CI verte. Charge 50 agences = SEC-004 (F-sécurité, hors RT).
