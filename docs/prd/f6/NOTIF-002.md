# NOTIF-002 : SMS Africa's Talking — confirmation, « vous êtes 3e », « vous êtes le suivant », templates par banque, opt-in STRICT

**Module** : F6 — Notifications & Jobs · **Agent** : agent-api · **Dépend de** : NOTIF-001, DB-005 (tables), CONTRACT-007 (surface), API-003 (événements de file) · **Statut** : TODO

> Consommateur (worker) de la queue `notifications:sms`. Rendu des templates par banque + langue, application STRICTE de l'opt-in, appel de l'adaptateur Africa's Talking, mise à jour du journal, et traitement du webhook de livraison sortant. Le déclenchement des messages de progression (« vous êtes 3e », « le suivant ») est **conditionné aux changements de position** émis par la file (API-003 `queue:updated` / recalcul de position) — cette story branche l'écoute et enfile les jobs.

## Exigences (EARS)

- **UBIQUITAIRE — opt-in STRICT (UEMOA)** : le système ne doit JAMAIS envoyer un SMS sans un consentement `opted_in = true` et `revoked_at IS NULL` pour `(bank_id, phone_hash, channel = SMS)` (table `notification_consents`, DB-005). L'absence de consentement → job non envoyé, `notification_log.status = FAILED`, `failure_reason = CONSENT_MISSING` (jamais d'erreur silencieuse, jamais d'envoi « au cas où »).
- **UBIQUITAIRE — non-PII** : aucun numéro en clair ne doit apparaître dans les logs applicatifs, la DLQ, ou toute réponse API ; seul `phoneNumberMasked` (calculé serveur, règle CONTRACT-007 : `07 •• •• •• 47`) est exposé. Le worker ne manipule le clair qu'en mémoire, le temps de l'appel fournisseur, après déchiffrement (DB-008).
- **QUAND (WHEN) un ticket est émis avec téléphone + `smsConsent = true`** (API-003), le système doit enfiler un SMS de **confirmation** (type `TICKET_CONFIRMATION`) rendu depuis le template `(bank_id, TICKET_CONFIRMATION, SMS, lang)` avec les variables `{{number}} {{position}} {{estimate}}`.
- **QUAND (WHEN) la position d'un ticket avec opt-in SMS atteint le seuil « proche » (défaut 3, configurable banque)**, le système doit enfiler un SMS `POSITION_NEAR` (« vous êtes 3e ») **une seule fois** par ticket (dédup via `dedupe_key` incluant le type).
- **QUAND (WHEN) le ticket devient le prochain à être appelé (position 1 / passage en tête)**, le système doit enfiler un SMS `POSITION_NEXT` (« vous êtes le suivant ») **une seule fois** par ticket.
- **QUAND (WHEN) le fournisseur Africa's Talking accepte l'envoi (2xx)**, le worker doit passer `notification_log.status = SENT` et stocker `provider_message_id` ; l'accusé `DELIVERED` n'arrive QUE par le webhook (voir ci-dessous).
- **QUAND (WHEN) le webhook `POST /webhooks/notifications/africastalking/delivery` reçoit un accusé** (CONTRACT-007, signature vérifiée → 401 sinon), le système doit mettre à jour le statut du journal (`DELIVERED` ou `FAILED` + `failure_reason` énuméré) par corrélation `provider_message_id`.
- **ÉTAT (WHILE) le template `(bank_id, type, SMS, lang)` est absent**, le système doit se rabattre sur le template **FR** par défaut de la banque, et à défaut sur le template FR global seedé (DB-005) ; jamais d'envoi d'un corps vide.
- **INDÉSIRABLE (IF…THEN)** : SI le consentement est révoqué (`revoked_at` posé) entre l'enfilement et le traitement ALORS le worker doit annuler l'envoi (re-vérification du consent AU MOMENT du traitement, pas seulement à l'enfilement) → `FAILED / CONSENT_REVOKED`.
- **INDÉSIRABLE (IF…THEN)** : SI le rendu d'un template référence une variable non fournie ALORS le worker doit échouer le job en DLQ avec `failure_reason = TEMPLATE_RENDER_ERROR` plutôt qu'envoyer un texte cassé (`{{position}}` littéral).
- **INDÉSIRABLE (IF…THEN)** : SI Africa's Talking répond 429 / erreur de quota ALORS le job doit suivre le retry/backoff de NOTIF-001 (transitoire), sans doublon.

## Critères d'acceptation

- [ ] `NOTIF-002: aucun envoi sans opt-in SMS valide — consent absent → FAILED/CONSENT_MISSING, zéro appel fournisseur (test)`
- [ ] `NOTIF-002: re-vérification du consent au traitement — révoqué après enfilement → FAILED/CONSENT_REVOKED (test)`
- [ ] `NOTIF-002: émission avec smsConsent=true → job TICKET_CONFIRMATION enfilé + rendu variables (test intégration)`
- [ ] `NOTIF-002: seuil position=3 franchi → un seul POSITION_NEAR par ticket (dédup dedupe_key) (test)`
- [ ] `NOTIF-002: passage en tête → un seul POSITION_NEXT par ticket (test)`
- [ ] `NOTIF-002: fallback template banque→FR banque→FR global ; jamais de corps vide (test)`
- [ ] `NOTIF-002: variable manquante → DLQ TEMPLATE_RENDER_ERROR, aucun SMS cassé envoyé (test)`
- [ ] `NOTIF-002: 2xx fournisseur → SENT + provider_message_id ; DELIVERED seulement via webhook (test avec adaptateur mocké)`
- [ ] `NOTIF-002: webhook africastalking signature invalide → 401 ; valide → statut journal mis à jour par provider_message_id (test)`
- [ ] `NOTIF-002: numéro jamais en clair dans logs/DLQ/réponses — seul phoneNumberMasked exposé (test structurel)`

## Redécoupage

**Aucun redécoupage nécessaire.** Story mono-couche (agent-api) : worker SMS + adaptateur fournisseur + webhook handler restent dans `apps/api`. L'édition des templates (UI + validation des variables) reste hors périmètre (CONTRACT-005 / F8). Le déclenchement s'appuie sur les événements de file existants (API-003) sans y toucher.

## Hors scope

WhatsApp (NOTIF-003) · email (NOTIF-004) · PWA/QR (NOTIF-005) · édition/validation des templates côté admin (CONTRACT-005, WEB-006) · chiffrement effectif du téléphone (DB-008) · infrastructure de queue/retry/DLQ (NOTIF-001).

## Hors scope DÉFINITIF (rappel constitution §5)

Pas de Core Banking / CRM / Mobile Money / USSD / biométrie / BCEAO. SIGFA 100% standalone. Langues **FR/EN uniquement** (Dioula/Baoulé retirés). Consentement traçable, droit à l'oubli déjà couvert par DB-005/DB-008. Voir `_notes.md` pour l'ajout de contrat requis (types `POSITION_NEAR`/`POSITION_NEXT`, seuil `smsNearThreshold` par banque) et le risque fournisseur.
