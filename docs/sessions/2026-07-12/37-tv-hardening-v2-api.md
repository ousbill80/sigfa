# Session 2026-07-12 — Lot « TV-hardening-v2 » (agent-api, worktree)

Exécution du lot défini par le panel (doc `36`). Périmètre : `apps/api/` uniquement.
1 finding sécu MINOR corrigé + 5 trous de test comblés (le 6e, re-mint web, déjà clos).

## F-SEC-TV-01 — ségrégation par rôle des rooms (fix ALLOWLIST défensive)

**Problème** : `socket-bus.ts` diffusait TOUT événement vers `agency:{id}`, room dont
l'écran mural PUBLIC (token DISPLAY) est membre. `alert:manager` (agentId, ticketId,
inactiveMinutes, métriques SLA) et `counter:status` fuitaient donc vers l'affichage public.

**Fix** :
- `realtime.ts` : allowlist `DISPLAY_EVENTS = ["ticket:called", "queue:updated"]`
  (`isDisplayEvent`), helpers `displayRoom(id)` = `agency:{id}` et
  `staffRoom(id)` = `agency:{id}:staff`. **Fail-closed** : tout événement hors allowlist
  (y compris FUTUR) est STAFF par défaut.
- `socket-bus.ts::createSocketBus` : route l'émission — affichage → `agency:{id}`,
  staff (tout le reste) → `agency:{id}:staff`.
- `socket-server.ts::handleJoinAgency` : une socket NON-DISPLAY rejoint `agency:{id}:staff`
  EN PLUS de `agency:{id}` ; le DISPLAY ne rejoint QUE `agency:{id}`, JAMAIS la room staff.
- `sync:state` n'est pas un événement de bus : il est émis directement à la socket
  demandeuse par `handleSyncRequest` (DISPLAY le reçoit sans room, sans PII).

**Preuve** (VRAI pipeline `createSocketServer` + `createSocketBus`, Testcontainers) :
- DISPLAY reçoit `ticket:called`, `queue:updated`, `sync:state` (les 3 signaux d'affichage) ;
- DISPLAY abonné à SA room ne reçoit JAMAIS `alert:manager` (contrôle positif : un
  `queue:updated` émis juste après arrive bien → pas un faux négatif de timing) ;
- une socket STAFF (AGENT) reçoit BIEN `alert:manager` → dashboards manager/COMEX préservés.

RED capturé avant le fix : DISPLAY recevait `alert:manager` (fuite exacte du finding).

## 5 trous de test comblés (assertions réelles)

1. **PII-free sur TOUS les events DISPLAY** (`tv-socket-display.test.ts`) : via bus réel,
   DISPLAY reçoit `queue:updated` et `sync:state` (buildSyncState réel) sans PII
   (phone/phone_encrypted/phone_hash/sms_consent/tracking/agentId absents) ; ne reçoit pas `alert:manager`.
2. **Token DISPLAY expiré** : JWT DISPLAY bien formé `exp` dépassé → handshake WS refusé.
3. **Token DISPLAY forgé (autre secret HS256)** : JWT DISPLAY parfait signé avec un secret
   attaquant → handshake WS refusé (vrai modèle de menace, pas une chaîne poubelle).
4. **429 / retryAfterSeconds** (`tv-session.test.ts`) : 21 POST /tv/session (>20/min/IP) →
   429 TOO_MANY_REQUESTS + `error.details.retryAfterSeconds` (≥1) + en-tête Retry-After.
5. **`sync:request` cross-agency par DISPLAY** : token DISPLAY agence A émettant
   `sync:request { agencyId: B }` → `error:forbidden` (hors scope), aucun `sync:state`.

## Couture consignée pour agent-web (aucune modif apps/web requise)

La room staff est purement serveur : un JWT staff qui émet `join:agency` est ajouté à
`agency:{id}:staff` de façon transparente (le serveur décide via `socket.data.isDisplay`).
Le manager/COMEX web passe déjà par le `SocketProvider` partagé (`socket-provider.tsx:159`
émet `join:agency { agencyId }`) → il rejoint le staff sans changement client, et continue
de recevoir `alert:manager`/`counter:status`.

**À VÉRIFIER par agent-web (non bloquant)** : confirmer que TOUT socket authentifié staff
(manager, COMEX/réseau) transite bien par ce `join:agency` unique — si un dashboard ouvrait
une room par un autre chemin sans `join:agency`, il faudrait l'aligner. Aucune régression
attendue : les tests RT-001/RT-002 et la parité bus↔contrat restent verts.

## Gate

- deps buildées (`@sigfa/schemas`→`testing`→`database`→`contracts`), `pnpm install --frozen-lockfile`.
- lint + typecheck `apps/api` : 0 `any`/`ts-ignore`/`console.log`.
- Testcontainers réels PG16/Redis7 : `socket-bus` (unit + intégration), `tv-socket-display`
  (11/11), `tv-session` (10/10, dont 429), `socket-server`, `contract-parity`, `realtime`.
- Schemathesis tv/session + suite tenant-isolation rejouées.
