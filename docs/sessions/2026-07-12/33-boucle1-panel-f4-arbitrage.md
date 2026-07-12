# Session 2026-07-12 — Panel adversarial Boucle 1 · LOT F4 (surfaces clientes kiosk/web+TV/mobile)

Fan-out parallèle de 4 relecteurs (lecture seule) sur `apps/kiosk/**`, `apps/web/**`, `apps/mobile/**` après clôture de la vague F4 (3 pistes DONE). `apps/api` et `packages/` exclus (panel F3 déjà passé + travail en cours dans un terminal parallèle : handler `POST /public/tickets` commité `fe7245e`, design v2 `e463ab3`).

Verdicts : **security → FINDINGS** (8 MAJOR, 4 MINOR) · **coverage → FINDINGS** (ratchet mobile KO, 4 verts vides, 9 critères non couverts) · **style → FINDINGS** (2 constats structurants + 13 findings) · **design → FINDINGS** (28 violations + inventaire de migration v2 en 21 chantiers S/M/L).

## Vérifications d'orchestrateur avant arbitrage (4/4 CONFIRMÉES)

- **SEC-F4-web-middleware CONFIRMÉ** : `apps/web/src/middleware.ts:15-35` décode le JWT **sans vérifier la signature** (split + base64, commentaire promettant jose « dans les API routes » — introuvable dans apps/web). Un cookie forgé `{ role: "SUPER_ADMIN" }` franchit le RBAC de toutes les pages protégées.
- **SEC-F4-web-layout CONFIRMÉ** : `apps/web/src/app/layout.tsx:50-57` lit le cookie httpOnly `access_token` côté serveur et le passe en prop client au `SocketProvider` → le JWT est sérialisé dans le payload RSC de TOUTES les pages (y compris /tv et /login), défaisant la protection httpOnly revendiquée par RT-003.
- **DES-F4-kiosk-tokens CONFIRMÉ (bug fondateur)** : `grep "\.css" apps/kiosk/src/app` → **zéro import**. `design-tokens.css` n'est chargé nulle part : toutes les `var(--*)` du kiosque sont non résolues à l'exécution. Cause directe probable du jugement « très mauvais » du PO sur le design F4.
- **SEC/STY-F4-mobile-flush CONFIRMÉ** : `apps/mobile/src/services/ticket-mmkv.ts:112-124` — `fetch` brut `POST /tickets` (route AGENT au contrat) sans auth, payload hors contrat (`phone`, `uemoaConsent`, `idempotencyKey` dans le body). La route légitime `POST /public/tickets` vient justement d'être implémentée côté serveur (`fe7245e`).

## Arbitrage

### BLOQUANT avant toute bascule réelle web (RT-001 web) — Boucle 2 F4, piste sécurité
| # | Surface | Finding | Correctif attendu |
|---|---|---|---|
| S1 | web | RBAC middleware sans vérification de signature (`middleware.ts:24`) | vérification jose (secret/JWKS) avant extraction du rôle |
| S2 | web | JWT httpOnly réinjecté dans l'arbre client (`layout.tsx:50`) | token socket dédié court/TTL ou handshake proxifié same-origin ; injection limitée aux routes authentifiées |
| S3 | web | admin + 3 dashboards en `NEXT_PUBLIC_API_URL` sans token ni proxy, tenant en dur côté client (`admin/page.tsx:31`) | généraliser le pattern proxy `/api/rt` (déjà appliqué à /agent) + tenant dérivé des claims |
| S4 | web | auth snake_case vs contrat camelCase (`login/route.ts:30`, `refresh/route.ts:21`) → cookies `undefined` contre l'API réelle | aligner sur `accessToken/refreshToken/expiresIn`, passer par le client typé |
| S5 | kiosk | session borne JWT (KIOSK-001) jamais câblée en runtime → sync + heartbeat sans Bearer = 401 en réel | `createKioskSession` au boot, token passé au client, renouvellement à expiration |
| S6 | kiosk | téléphone complet + consentement dans l'URL `/ticket` (historique d'un appareil PARTAGÉ, UEMOA) (`ConfirmationScreen.tsx:106`) | transport en mémoire (contexte/store), purge après affichage |
| S7 | mobile | `flush()` hors contrat et sans auth (`ticket-mmkv.ts:112`) | réécrire sur `POST /public/tickets` (channel MOBILE) via client typé — le handler serveur existe depuis `fe7245e` |
| S8 | mobile | files MMKV sans `encryptionKey`, téléphone en clair au repos (`offline-queue.ts:5`) | encryptionKey via trousseau (expo-secure-store) |

### CORRIGER en Boucle 2 F4 — dette de couverture et coutures contrat
1. **Ratchet mobile KO** : 7 fichiers < 85% (`app/(app)/index.tsx` 75%, `step-3.tsx` 80%, `live-activity.ts` 82.35%, `history-mmkv.ts`, `ticket-mmkv.ts`, `useFeedback.ts`, `useNetworkStatus.ts`). Kiosk 99.19% / web 99.40% : OK.
2. **Verts vides** (preuves fichier:ligne au rapport coverage) : timeout accessibilité 60s kiosk (`expect.any(Number)`), 6 tests `not.toThrow()` mob-001, notification Android mob-003 sans assertion de contenu, trackingId testé hors pattern nanoid(21).
3. **Coutures contrat à router vers agent-contract** : `join:agency` absent de `events/realtime.ts` ET émis sous 2 formes différentes (objet côté web, chaîne nue côté kiosk) ; `deviceToken` vs `token` sur `/notifications/devices` ; route OTP mobile inexistante au contrat (mock `123456` à garder derrière `__DEV__` jusqu'à F6).
4. **9 critères EARS non couverts** (liste au rapport) dont X-Idempotency-Key WEB-006 et rejeu idempotent MOB-002.

### CONSIGNÉ — vague dédiée « Refonte v2 Sérénité Premium » (gate PO)
Le design-reviewer a produit l'**inventaire complet de migration v1→v2 : 21 chantiers** (1 L fondation `packages/ui` : tokens.css v2 + primitives + polices ; 8 kiosk ; 9 web dont manager et admin en L ; 4 mobile ; purges i18n en S). À découper en stories PRD (`docs/prd/f5-design/` ou équivalent) avec DESIGN-gates humains — **ne pas dispatcher sans GO PO**, la refonte étant une exigence produit portée par le PO.
Y adjoindre les 2 constats structurants du style-reviewer (mêmes fondations) : `@sigfa/ui` coquille vide → bannière offline tripliquée, 3 systèmes i18n, tokens re-hardcodés divergents (`#2E90FA` mobile vs `#1570ef` kiosk) ; et le **bug fondateur kiosque** (tokens jamais importés) qui peut être corrigé dès la Boucle 2 (1 ligne d'import) sans attendre la refonte.

### CONSIGNÉ — purge FR/EN (décision PO, transverse aux 3 surfaces)
Résidus Dioula/Baoulé : kiosk `messages/dioula.json`+`baoule.json`, `routing.ts:8`, `kiosk-voice.ts:42-43`, HomeScreen 4 cartes ; web `i18n.ts:7,319-525` ; mobile `locales/dioula.ts`/`baoule.ts` + ~15 fichiers de test itérant ×4 langues. Purge naturellement portée par la vague refonte v2 (les écrans concernés y repassent tous).

### Écarts de processus (à fixer au niveau méthode)
- **`red_run_output` absent** des rapports de session F4 (`21-f3f4-salve1.md`, `23-f3f4-salve2-ci-verte.md`) — la preuve TDD exigée par la constitution n'a pas été journalisée pour ce lot.
- Convention nommage fichiers kiosk/mobile (PascalCase composants) vs web (kebab-case) : trancher et amender CLAUDE.md §7.

## Bien couvert (relevé par le panel — pas d'action)
Electron durci (`nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, zéro IPC exposé) · zéro XSS (aucun dangerouslySetInnerHTML/eval sur les 3 apps) · zéro secret en dur · payloads socket entrants validés Zod des deux côtés · idempotence client systématique (randomUUID + X-Idempotency-Key) · cookies httpOnly+secure+lax au login · suites offline kiosk et mobile réelles et vertes · 766 tests verts sur les 3 apps, ratchet OK kiosk/web · KIOSK-006 sync offline intégralement couvert (contre-vérifié : fausse alerte de première passe réfutée par le coverage-checker lui-même).

## État
F4 : 20/20 stories DONE + **Boucle 1 panel rendue** (ce document). Prochaines étapes : **Boucle 2 F4** (8 fixes sécurité S1-S8 + ratchet mobile + verts vides + coutures contrat via agent-contract) puis **vague Refonte v2** (21 chantiers, gate PO). Le fix « import tokens kiosk » (1 ligne) est dispatchable immédiatement en Boucle 2.
