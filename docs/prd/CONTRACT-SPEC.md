# SIGFA — SPÉCIFICATION DU CONTRAT PRODUIT
## Entrée de agent-contract · Endpoints + Événements · /api/v1

> Ce document liste CE QUE le contrat doit couvrir. `agent-contract` le transforme
> en OpenAPI 3.1 (stories CONTRACT-001..009). Chaque endpoint : 9 codes de réponse,
> scope tenant, exemples. Mutations critiques (†) : X-Idempotency-Key obligatoire.

## 1. Auth
POST /auth/login · POST /auth/refresh · POST /auth/logout · GET /auth/me

## 2. Ressources cœur (scope: bank sauf mention)
Banks      : GET/POST /banks (super-admin) · GET/PATCH /banks/:id
Agencies   : GET/POST /agencies · GET/PATCH/DELETE /agencies/:id · POST /agencies/:id/clone-from/:templateId
Services   : GET/POST /services · PATCH /services/:id (SLA, ordre, actif)
Counters   : GET/POST /counters · PATCH /counters/:id (statut OPEN/PAUSED/CLOSED, agent affecté)
Queues     : GET /queues?agencyId= · PATCH /queues/:id (open/pause, plage horaire)

## 3. Tickets (le cœur)
POST   /tickets †                    émission (borne/QR/mobile/whatsapp), retourne numéro+position+estimation
GET    /tickets/:id                  suivi (position temps réel)
POST   /counters/:id/call-next      appel du SUIVANT (sélection serveur par priorités ; 404 QUEUE_EMPTY si file vide) [ajout Boucle 1 F1]
POST   /tickets/:id/call             appel CIBLÉ/re-appel (lock : 409 si déjà pris)
POST   /tickets/:id/serve            début de service
POST   /tickets/:id/close †          clôture (calcule waitTime/serviceTime)
POST   /tickets/:id/no-show          après timeout configurable
POST   /tickets/:id/transfer         vers autre guichet/service
POST   /tickets/:id/abandon
POST   /tickets/sync †               batch offline : uuid locaux (max 100), idempotent, zéro doublon
POST   /public/tickets/:trackingId/feedback   note 1-5 + commentaire (CONTRACT-003 — accès client par trackingId, JAMAIS core) [amendé Boucle 1 F1]

## 3bis. Surface publique & borne (CONTRACT-003) [ajout Boucle 1 F1]
POST /kiosk/session (JWT borne 12h) · DELETE /kiosk/session/:kioskId · POST /kiosks/:kioskId/heartbeat (printerStatus)
GET /public/tickets/:trackingId (nanoid 21, cache 30s) · GET /agencies/:id/qr
POST /webhooks/whatsapp/inbound/{bankSlug} (HMAC par banque)

## 4. Agents & compétences
GET/PATCH /agents/:id (services, langues, horaires) · POST /agents/:id/status (AVAILABLE/SERVING/PAUSED/ABSENT)
GET /agents/:id/stats (tickets traités, TMT jour) · POST /agents/import (CSV onboarding)

## 5. Admin & config
GET/PATCH /banks/:id/theme (logo, brand → contraste auto-corrigé)
GET/PATCH /agencies/:id/hours (+ fériés CI pré-chargés) · GET/PATCH /banks/:id/sms-templates
GET/PATCH /banks/:id/thresholds (file critique, inactivité) · RBAC : matrice 6 rôles sur toutes les routes
GET /audit-logs (SUPER_ADMIN|AUDITOR — SEC-001/DB-004) · POST /data/purge-phone † + GET /data/retention-policy (droit à l'oubli UEMOA — DB-008)
POST /agencies/:id/kiosk-access (credentials borne + QR installation) · GET /banks/:id/theme/logo-upload-url (R2 signée) [ajouts Boucle 1 F1]

## 6. Reporting
GET /reports/kpis?scope=agency|network&period= (TMA,TMT,TTS,abandon,SLA,NPS,occupation)
GET /reports/daily/:agencyId · GET /reports/export?format=pdf|xlsx|json
GET /reports/benchmark (classement agences)

## 7. Notifications
POST /notifications/test · GET /notifications/log?ticketId= (téléphones masqués) · opt-in/opt-out par téléphone
POST/DELETE /notifications/devices (tokens push mobile — MOB-004) · POST /webhooks/notifications/{provider}/delivery (accusés sortants) [ajouts Boucle 1 F1]

## 8. IA
GET /ai/forecast?agencyId=&date= (422 INSUFFICIENT_HISTORY si <90j) · GET /ai/staffing-recommendations + POST .../:id/ack
GET /ai/anomalies?status=open + POST .../:id/ack · GET /ai/feedback-insights?period= [acks ajoutés Boucle 1 F1]

## 9. Supervision
GET /health · GET /kiosks/status (ping bornes) · GET /admin/network-overview (super-admin, lecture cross-tenant)

## 10. Événements Socket.io (rooms par agence : agency:{id})
ticket:created {ticket, position, estimate}      → borne, dashboard
ticket:called  {ticket, counter}                 → écran TV, dashboard, mobile — <500ms
ticket:closed  {ticketId, waitTime, serviceTime} → dashboard
counter:status {counterId, status, agentId}      → dashboard
queue:updated  {queueId, length, estimate}       → borne (attente temps réel), dashboard, mobile
agency:offline {agencyId, since}                 → dashboard réseau
alert:manager  {type, payload}                   → dashboard manager (inactif, SLA, déconnexion)
