# NOTIF-001 : Infrastructure BullMQ — queues, retry, dead-letter, idempotence d'envoi

**Module** : F6 — Notifications & Jobs · **Agent** : agent-api · **Dépend de** : API-003 (DONE) · **Statut** : TODO

> Fondation de tout le module F6 : NOTIF-002/003/004/005 s'appuient sur les queues, la sémantique de retry/dead-letter et le contrat d'idempotence d'envoi définis ici. Aucun envoi réel de message dans cette story (pas d'appel fournisseur) — uniquement l'infrastructure de jobs et un **worker de test « noop »** qui prouve le cycle de vie complet.

## Exigences (EARS)

- **UBIQUITAIRE — un job = un envoi idempotent** : chaque job d'envoi doit porter une clé d'idempotence déterministe `notification_dedupe_key = hash(bank_id, ticket_id, type, channel, phone_hash|device_id)`. Le système doit garantir qu'un même `dedupe_key` ne produit **jamais** deux lignes `notification_log` en statut `SENT`/`DELIVERED` (dédup via `jobId` BullMQ = `dedupe_key` + garde applicative en base sur `notification_log`).
- **UBIQUITAIRE — une queue par canal** : le système doit exposer des queues BullMQ distinctes `notifications:sms`, `notifications:whatsapp`, `notifications:email`, `notifications:push` (Redis 7, prefix par environnement) pour isoler les débits, quotas et pannes fournisseur par canal.
- **QUAND (WHEN) un producteur enfile un envoi**, le système doit créer/mettre à jour la ligne `notification_log` en `QUEUED` (DB-005) AVANT le retour au producteur, puis enfiler le job avec `jobId = dedupe_key`.
- **QUAND (WHEN) un job échoue de façon transitoire** (timeout réseau, 5xx fournisseur, rate-limit fournisseur), le système doit réessayer avec **backoff exponentiel plafonné** (base 5 s, facteur 2, jitter, max 5 tentatives, plafond 5 min) sans dupliquer l'envoi.
- **QUAND (WHEN) un job épuise ses tentatives**, le système doit le déplacer dans une **dead-letter queue** `notifications:dlq` en conservant le payload complet + `failure_reason` énuméré (LA LOI CONTRACT-007) et passer `notification_log.status = FAILED`.
- **ÉTAT (WHILE) un envoi est en cours de traitement**, la ligne `notification_log` correspondante doit refléter l'état de progression (`QUEUED → SENT` à l'accusé fournisseur synchrone, `DELIVERED` réservé au webhook de CONTRACT-007) ; aucun état intermédiaire non prévu par l'enum ne doit être écrit.
- **INDÉSIRABLE (IF…THEN)** : SI un job est rejoué manuellement depuis la DLQ ALORS le système doit réutiliser le même `dedupe_key` et NE PAS créer de doublon `SENT`/`DELIVERED`.
- **INDÉSIRABLE (IF…THEN)** : SI Redis est indisponible au moment de l'enfilement ALORS le producteur doit échouer proprement (erreur remontée, `notification_log` reste `QUEUED` ou n'est pas créé selon l'ordre transactionnel) et NE JAMAIS marquer un envoi `SENT`.
- **INDÉSIRABLE (IF…THEN)** : SI un job cible un `bank_id` différent de celui du log/consent chargé ALORS le worker doit refuser (garde tenant applicative — les workers tournent hors requête HTTP donc hors RLS de session ; le `bank_id` du job est LA source de vérité et est comparé aux données chargées).
- **UBIQUITAIRE — observabilité** : chaque queue doit exposer des compteurs (waiting/active/failed/completed/delayed) consommables par la supervision (F11) et un helper `getQueueHealth()` réutilisable par `GET /health` (API-011, extension non-breaking, signalée en contrat).

## Critères d'acceptation

- [ ] `NOTIF-001: 4 queues canal + 1 DLQ instanciées avec prefix d'environnement (test Testcontainers Redis)`
- [ ] `NOTIF-001: dedupe_key déterministe — mêmes entrées → même clé, entrée différente → clé différente (test unitaire hash)`
- [ ] `NOTIF-001: enfilement crée notification_log QUEUED avant retour producteur (test intégration)`
- [ ] `NOTIF-001: jobId = dedupe_key → double enfilement du même envoi = un seul job, un seul SENT (test course)`
- [ ] `NOTIF-001: échec transitoire → backoff expo plafonné (base 5s, max 5 essais, plafond 5min), jitter présent (test fake-timers)`
- [ ] `NOTIF-001: épuisement des tentatives → job en DLQ avec payload+failure_reason, log FAILED (test)`
- [ ] `NOTIF-001: rejeu DLQ avec même dedupe_key → zéro doublon SENT/DELIVERED (test)`
- [ ] `NOTIF-001: Redis down à l'enfilement → producteur échoue, aucun SENT écrit (test coupure Testcontainers)`
- [ ] `NOTIF-001: worker refuse un job dont bank_id ≠ bank_id des données chargées (test tenant-isolation worker)`
- [ ] `NOTIF-001: getQueueHealth() retourne les compteurs par queue (test) ; branchable sur /health`

## Hors scope

Envois réels par canal et intégrations fournisseur (NOTIF-002 SMS, NOTIF-003 WhatsApp, NOTIF-004 email, NOTIF-005 PWA) · édition des templates (CONTRACT-005) · webhooks de livraison entrants (traités par NOTIF-002/003/004 selon le canal, contrat CONTRACT-007) · dashboards de supervision (F11).

## Hors scope DÉFINITIF (rappel constitution §5)

Aucun connecteur Core Banking / CRM / Mobile Money / USSD / biométrie / BCEAO. SIGFA reste 100% standalone. Langues **FR/EN uniquement** (Dioula/Baoulé retirés — décision PO). Toute route ou événement Socket.io nouveau requiert d'abord une story **CONTRACT** amont (racine du DAG) — voir `_notes.md`.
