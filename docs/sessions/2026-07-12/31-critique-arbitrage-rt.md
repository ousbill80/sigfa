# Session 2026-07-12 — Arbitrage des critiques · VAGUE RT (Boucle 1, itération 1)

**Verdicts** : completeness → **GAPS** (3 BLOCKER) · ambiguity → **AMBIGUOUS** (5 BLOCKER) · feasibility → **INFEASIBLE** (3 BLOCKER). Convergence des 3 sur une même faille structurelle du draft RT-001 (routage/forme du bus socket). Table de DÉCISIONS EXÉCUTOIRES ci-dessous (appliquées aux stories en v2).

## Faille centrale (RT-B1/B2/B3 · RT-AMB-07 · RT-FEAS-01/02) — le bus socket
Le draft postulait `createSocketBus(io)` routant `io.to('agency:'+payload.agencyId)`. Réalité du code :
- Les schémas du bus applicatif (`apps/api/src/services/realtime.ts`, `EVENT_SCHEMAS`) DIVERGENT du contrat (`packages/contracts/events/realtime.ts`). Ex. `ticket:called` interne = `{ticketId,queueId,counterId,displayNumber,status}` (aplati) VS contrat `{ticket:{id,number,status,serviceId,agencyId,channel,createdAt}, counter:{id,label}}`.
- 5 des 7 événements internes ne portent PAS d'`agencyId` (seuls `ticket:created` et `kiosk:printer-error` l'ont) ; `counter:status`/`alert:manager` n'ont même pas l'agencyId en scope au site d'émission.
- `emitTicketCalled` (socket-server.ts) émet DÉJÀ la forme contrat → deux formes `ticket:called` incompatibles coexistent.

### DÉCISION 1 — `createSocketBus` est un ADAPTATEUR contrat + `emit` prend l'agencyId explicitement
- **Signature du bus étendue** : `bus.emit(event, agencyId, payload)`. Les ~8 sites d'émission F3 (tickets.ts, tickets-sync.ts, agent-status.ts, agent-disconnect.ts, queues.ts) passent l'`agencyId` (déjà dérivable du scope tenant/route ; là où absent — `counter:status`/`alert:manager` — la route le résout une fois). **C'est un travail RT explicite** (retouche de sites F3 DONE + mise à jour de leurs tests), pas un « simple adossement ».
- **`createSocketBus(io)` MAPPE la forme interne → forme CONTRAT** par événement (hydratation des champs manquants depuis le payload interne ; lookup DB minimal UNIQUEMENT si un champ requis par le contrat est absent — à éviter sur le chemin latence). La sortie diffusée DOIT valider `payloadSchema` du **contrat** (parité testée par événement).
- **`emitTicketCalled` est absorbé** par l'adaptateur (chemin d'émission unique) — fin de la double forme.
- Critère : « `createSocketBus` diffuse LES 7 événements sur `agency:{agencyId}`, chacun conforme au `payloadSchema` du contrat, testé ». Ceci résorbe aussi la dette STY-001/002 (convergence forme interne↔contrat).

## Ambiguïté de bascule (RT-AMB-01/02)
### DÉCISION 2 — `REALTIME_MODE` fait autorité ; matrice de défauts explicite
- **`REALTIME_MODE ∈ {off, real}`** est LA variable autoritaire côté SERVEUR (off → `createNoopBus`, ni socket ni scheduler ; real → `createSocketBus` + `startAlertScheduler`).
- Côté CLIENT, l'URL (`NEXT_PUBLIC_API_URL` web/kiosk, équivalent Expo mobile) pointe soit le mock Prism, soit l'API réelle — **dérivée du mode**, jamais contradictoire. Table normative dans le _dag :
  | Surface | Variable | off / défaut | real |
  |---|---|---|---|
  | api | `REALTIME_MODE` | `off` (défaut, y compris tests) | `real` |
  | web/kiosk | `NEXT_PUBLIC_API_URL` | mock Prism (uniformisé — corriger 4010/3000) | URL API réelle |
  | mobile | `EXPO_PUBLIC_API_URL` | mock/polling | API réelle (si applicable) |
- Incohérence à corriger : web défaut `:4010`, kiosk défaut `:3000` → aligner sur une valeur mock canonique.

## Périmètre clients (RT-M1/M2 · RT-FEAS-03)
### DÉCISION 3 — clients socket : web ACTIVÉ, kiosk CRÉÉ, mobile PENDING (polling)
- **web** : le `SocketProvider` (stub `socket-provider.tsx`) est ÉCRIT/ACTIVÉ (io() client, handshake JWT, `join:agency`, handlers des événements consommés, `sync:request` au (re)connect, états error/offline). Ce n'est PAS un simple flip — livrable détaillé.
- **kiosk** : `socket.io-client` + provider à CRÉER (aucun n'existe) — livrable RT-001 (surfaces TV/appels en dépendent).
- **mobile** : `socket.io-client` ABSENT des deps + contrainte Metro (MOB-001) → **PENDING** : le **polling (cache 30 s) reste le chemin par défaut mobile** en RT-001 ; la bascule socket mobile = story ultérieure (ajout dep native-compatible + provider + validation Metro). RT-001 ne prétend plus « SocketProvider mobile ouvre une connexion réelle ».

## États & sémantique (RT-AMB-04 · RT-M3/M5 · RT-M4/RT-AMB-06)
### DÉCISION 4 — resync = convergence d'ÉTAT (snapshot), pas rejeu
`sync:state` est un SNAPSHOT (files/guichets/`recentCalls`≤4). « Aucune perte définitive » = **l'état FINAL du client après resync == état serveur** (convergence). Les événements transitoires manqués pendant la coupure sont acceptablement absorbés par le snapshot. Le rejeu d'événements manqués est HORS scope (le contrat ne le permet pas).
### DÉCISION 5 — `buildSyncState.estimate` : hors scope resync exact en RT (documenté)
`buildSyncState` renvoie `estimate:0` en dur ; le calcul d'estimation exact au resync est HORS scope RT (l'estimation temps réel vit dans les routes API-004). Critère RT-002 « état exact » = files/guichets/recentCalls, PAS estimate. À tracer.
### DÉCISION 6 — ordre bootstrap & graceful shutdown spécifiés
Bootstrap : connect PG/Redis (fail-fast) → `serve()` capture `httpServer` → `createSocketServer(httpServer)` → `startAlertScheduler`. Arrêt (SIGTERM/SIGINT) : `io.close()` → fermeture workers BullMQ (drain borné, timeout) → PG/Redis. Critère de shutdown testable.
### DÉCISION 7 — états CLIENT d'échec de handshake
Handshake refusé (borne révoquée / JWT expiré → `connect_error UNAUTHORIZED`) → le provider passe en état **error + repli offline F4**, PAS de boucle de reconnexion infinie. `error:forbidden` (join/sync hors scope) → non-crash. Critères ajoutés RT-001-B.

## Latence & harnais (RT-FEAS-04/05 · RT-AMB-03/09)
### DÉCISION 8 — p95 = SLA loopback mesuré avec protocole, PAS gate horloge-murale
Rappel leçon F3 (assertion 500 ms par appel RETIRÉE). RT-002 : `t0 = io.emit` serveur, `t1 = handler client`, ≥50 échantillons, warm-up exclu, même hôte (loopback + Testcontainers), transport websocket. Seuil <500 ms = SLA réseau loopback+adapter documenté, avec marge/répétitions ; JAMAIS un gate bloquant horloge-murale par appel. Multi-instance : nouveau harnais (2× `createSocketServer` port:0, 1 Redis partagé) — tâche RT-002 dédiée (base = `admin-test-harness.ts`).

## Electron (RT-AMB-05 · RT-FEAS-06)
### DÉCISION 9 — repli Electron par défaut + seuil objectif
RT-003 : filet automatisé = **E2E navigateur (Next hors Electron)**. Electron réel CI = best-effort (xvfb/libgbm documenté) ; le repli **gate humain démo tracé** est autorisé APRÈS ≥2 runs CI Electron rouges consignés (seuil objectif) ; trace = fichier `docs/sessions/…` daté. Pas de DONE auto-attestant.

## Rejets / notes
- `agency:offline` (contrat) n'est émis nulle part et son consommateur (network-dashboard) est F4 non construit → **PENDING**, hors RT-001 (consigné, RT-m1).
- Type de retour `serve()` v2 = union `ServerType` → simple cast `as unknown as http.Server` (déjà pratiqué en test) — non bloquant (RT-FEAS-08).
- `REALTIME_MODE=off` protège les 447 tests (ils injectent CaptureBus/noop, ne touchent pas le nouveau chemin) — non-régression confirmée (RT-FEAS-07).

## Conséquence sur le DAG
RT-001 est plus lourd qu'un « flip d'env » : (A) enablement serveur + **adaptateur bus + retouche des sites d'émission F3** (convergence forme contrat), (B) **écriture des clients socket web (activation) + kiosk (création)**, mobile PENDING (polling). Découpage possible en RT-001a (serveur+bus) puis RT-001b (clients) — séquentiel. **En attente : GO PO sur RT v2 avant Boucle 2.**
