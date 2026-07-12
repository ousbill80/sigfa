# Session 2026-07-12 — Panel adversarial sur le durcissement token TV + lot de correctifs consigné

Panel de revue (lecture seule) sur le lot « durcissement token d'affichage TV public » (commits `bd6d396`/`c1506c9`/`7bcbb5f`, doc `35`). Fan-out : `security-reviewer` + `test-coverage-checker`. Verdicts : **sécurité → FINDINGS (1 MINOR)** · **couverture → FINDINGS (6 trous, ratchet OK)**.

## Ce que le panel confirme SAIN (pas d'action)
404 réellement opaque (3 motifs testés) ; JWT DISPLAY minimal, `bankId` dérivé serveur jamais accepté du client, TTL 43200 s non renouvelable ; rate-limit monté avant l'auth, non contournable via XFF (`TRUST_PROXY`, fix SEC-F3-07) ; DISPLAY orthogonal (absent de `ROLE_HIERARCHY`, refusé sur toute route HTTP, leçon SEC-F3-01 non reproduite) ; handshake DISPLAY signé HS256 non forgeable ; confinement `join:agency`/`sync:request` à la seule room de l'agence ; schémas realtime sans PII client (aucun téléphone) ; S2 fermée côté web (aucun cookie/JWT agent réinjecté, token DISPLAY en mémoire seule) ; web 12/12 + contract 20/20 verts, tv-realtime 100 %, tv-session 97.97 %.

## Findings à corriger (lot « TV-hardening-v2 »)

### SÉCURITÉ — MINOR (à corriger avant prod)
**F-SEC-TV-01 — les alertes de supervision fuitent vers l'écran mural public.** `apps/api/src/services/socket-bus.ts:54` émet vers `agency:{id}` **sans segmentation par rôle** ; `alert:manager` (`agent-disconnect.ts:135`, `alert-jobs.ts:111/175`) porte `agentId`, `ticketId`, `inactiveMinutes`, métriques SLA. Une socket DISPLAY (écran public) est membre de `agency:{id}` et peut recevoir ces signaux opérationnels internes. Pas de PII client, mais divulgation de supervision interne sur un affichage public ; aucun ACL par event ne l'empêche.
- **Fix** : router les events management/staff (`alert:manager`, `counter:status`) vers une room dédiée `agency:{id}:staff` que le socket DISPLAY ne rejoint **jamais** (seuls agent/manager la rejoignent), OU filtrer l'émission par `socket.data.isDisplay`. Le DISPLAY ne reçoit que `ticket:called` / `queue:updated` / `sync:state`.
- **Contrainte** : ne pas casser la réception des alertes par les dashboards manager/COMEX (ils doivent rejoindre la room staff). Touche `socket-bus.ts` + `socket-server.ts` (topologie de rooms) → à faire avec les tests RT-001/002 rejoués.

### COUVERTURE — 6 trous (tous confirmés, faux positifs écartés)
1. **PII-free incomplet** : prouvé seulement sur `ticket:called` et contre le serveur éphémère de test, pas le vrai `buildSyncState`. `sync:state` et `queue:updated` reçus par DISPLAY ne sont pas assertés PII-free (le code `buildSyncState` ne projette pas de PII, mais aucun test ne le garde).
2. **Token DISPLAY expiré** : aucun test du refus au handshake / HTTP à expiration (le TTL 12 h non renouvelable n'a pas de preuve de rejet).
3. **Token DISPLAY forgé (autre secret HS256)** : `socket-server.test.ts:342` ne teste qu'une chaîne poubelle, pas un JWT DISPLAY bien formé signé avec un autre secret (le vrai modèle de menace).
4. **429 / `retryAfterSeconds` serveur** : non testé sur `POST /tv/session` (schemathesis ne vérifie que `not_a_server_error`, `max-examples 20` < limite). Asymétrie : le backoff EST testé côté web, le déclenchement 429 ne l'est pas côté serveur.
5. **Re-mint avant expiration (web)** : `tv-session.ts:186-187` (corps du `setTimeout` de re-mint) non exercé — seul manque côté web, isolable.
6. **`sync:request` cross-agency par DISPLAY** : la garde existe (`socket-server.ts:274`) mais seul `join:agency` cross-agency est testé.

## Pourquoi consigné et non corrigé immédiatement
Au moment du panel, le terminal parallèle mène un **chantier api massif non commité** (MODEL-API-B : files par conseiller, stratégie de queue) touchant `socket-bus.integration.test.ts`, `socket-server.test.ts`, `agent-disconnect.test.ts`, `alert-jobs.test.ts`, `rbac-route-map.ts`, `tickets.ts` et même `tv-socket-display.test.ts`. Le fix F-SEC-TV-01 touche exactement ces fichiers (socket-bus/socket-server/alert-jobs) → collision frontale garantie. **Discipline de coordination : ne pas ouvrir de chantier api tant que le parallèle n'a pas commité et stabilisé apps/api.**

## Plan d'exécution (dès que apps/api est stable)
1. `agent-api` (worktree) : F-SEC-TV-01 (room `:staff` + DISPLAY exclu, dashboards rejoignent staff) + trous de couverture 1,2,3,4,6 (PII-free tous events via pipeline réel, token expiré, token forgé autre secret, 429 `retryAfterSeconds`, sync:request cross-agency). Gate complet Testcontainers + Schemathesis, RT-001/002 rejoués.
2. `agent-web` (worktree) : trou 5 (re-mint avant expiration, fake timers, `tv-session.ts:186-187`). **Isolable dès maintenant** si souhaité (apps/web propre côté working tree).

## État
Panel rendu, lot « TV-hardening-v2 » défini et priorisé (1 MINOR sécu + 6 trous de test). Aucun bloqueur produit (findings non critiques). Exécution en attente de la fenêtre où apps/api est propre.
