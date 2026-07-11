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
POST   /tickets/:id/call             appel par agent (lock : 409 si déjà pris)
POST   /tickets/:id/serve            début de service
POST   /tickets/:id/close †          clôture (calcule waitTime/serviceTime)
POST   /tickets/:id/no-show          après timeout configurable
POST   /tickets/:id/transfer         vers autre guichet/service
POST   /tickets/:id/abandon
POST   /tickets/sync †               batch offline : uuid locaux, idempotent, zéro doublon
POST   /tickets/:id/feedback         note 1-5 + commentaire

## 4. Agents & compétences
GET/PATCH /agents/:id (services, langues, horaires) · POST /agents/:id/status (AVAILABLE/SERVING/PAUSED/ABSENT)
GET /agents/:id/stats (tickets traités, TMT jour) · POST /agents/import (CSV onboarding)

## 5. Admin & config
GET/PATCH /banks/:id/theme (logo, brand → contraste auto-corrigé)
GET/PATCH /agencies/:id/hours (+ fériés CI pré-chargés) · GET/PATCH /banks/:id/sms-templates
GET/PATCH /banks/:id/thresholds (file critique, inactivité) · RBAC : matrice 6 rôles sur toutes les routes

## 6. Reporting
GET /reports/kpis?scope=agency|network&period= (TMA,TMT,TTS,abandon,SLA,NPS,occupation)
GET /reports/daily/:agencyId · GET /reports/export?format=pdf|xlsx|json
GET /reports/benchmark (classement agences)

## 7. Notifications
POST /notifications/test · GET /notifications/log?ticketId= · opt-in/opt-out par téléphone

## 8. IA
GET /ai/forecast?agencyId=&date= · GET /ai/staffing-recommendations
GET /ai/anomalies?status=open · GET /ai/feedback-insights?period=

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
