## KIOSK-006 : Offline-first complet — Dexie.js, numérotation locale séquentielle, badge discret, sync idempotente

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-004 (parallèle à KIOSK-005) · **Statut** : DONE (2026-07-12)

**Révision** : v2 — arbitrage 19

### Exigences (EARS)

- UBIQUITAIRE : KIOSK-006 **implémente** le hook `useOfflineTicket()` (déclaré stub dans KIOSK-004) — Dexie.js IndexedDB, `localUuid` UUID v4 client, numérotation locale séquentielle, jamais de doublon visible.
- QUAND la connexion réseau est absente, le système doit émettre un ticket localement (Dexie.js), afficher le Moment Ticket identique à l'état nominal, et afficher le bandeau discret `--info: #2E90FA` : « Mode hors connexion — vos tickets restent valables » — le parcours client est inchangé.
- QUAND la connexion réseau est rétablie, le système doit déclencher automatiquement POST `/tickets/sync` via `@sigfa/contracts` avec les tickets en attente (batch ≤ 100 `localUuid`, `X-Idempotency-Key` batch UUID v4).
- QUAND POST `/tickets/sync` retourne 200, le système doit reconcilier les `localUuid` avec les `serverId` retournés et supprimer les entrées Dexie correspondantes.
- QUAND POST `/tickets/sync` retourne 422 `BATCH_TOO_LARGE` (> 100 tickets), le système doit découper en batches de 100 et rejouer.
- SI un `localUuid` est retourné dans `skipped` (raison `SERVICE_NOT_FOUND` ou autre), ALORS le système doit loguer l'incident sans alerter le client. **L'alerte `alert:manager` de type `KIOSK_SYSTEM_ERROR` est émise par le SERVEUR (API-005) — la borne affiche seulement l'état, n'émet pas l'alerte elle-même.**
- LÀ OÙ le badge offline est visible, il doit disparaître en fondu (250 ms) au retour du réseau.

### Critères d'acceptation

- [ ] `KIOSK-006: ticket offline créé dans Dexie avec localUuid unique (test Dexie in-memory)`
- [ ] `KIOSK-006: parcours client identique online et offline — snapshot comparé (Testing Library)`
- [ ] `KIOSK-006: bandeau --info visible offline, disparu en 250 ms au retour réseau`
- [ ] `KIOSK-006: retour réseau → POST /tickets/sync déclenché automatiquement`
- [ ] `KIOSK-006: sync batch ≤ 100 localUuid, X-Idempotency-Key présent`
- [ ] `KIOSK-006: 422 BATCH_TOO_LARGE → découpage en batches de 100 (Vitest)`
- [ ] `KIOSK-006: useOfflineTicket() implémenté (Dexie + numérotation locale) — remplace le stub KIOSK-004`
- [ ] `KIOSK-006: skipped localUuid → zéro alerte émise par la borne (alerte = serveur API-005), log interne uniquement`
- [ ] `KIOSK-006: sync idempotente — même batch rejoué deux fois → zéro doublon (test rejeu)`
- [ ] `KIOSK-006: suite offline Vitest complète (gate 9 étapes §CLAUDE.md)`

### Hors scope de cette story

États dégradés visuels avancés (KIOSK-007), numérotation serveur réconciliée sur l'écran TV (F5/RT-001).
