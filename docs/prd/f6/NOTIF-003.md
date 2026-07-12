# NOTIF-003 : WhatsApp Business — prise de ticket par message entrant + avancement

**Module** : F6 — Notifications & Jobs · **Agent** : agent-api · **Dépend de** : NOTIF-002 (worker/opt-in/templates réutilisés), CONTRACT-003 (webhook inbound `/webhooks/whatsapp/inbound/{bankSlug}`), CONTRACT-007 (canal WHATSAPP + delivery webhook), API-003 (cycle de vie ticket) · **Statut** : TODO

> Consommateur de la queue `notifications:whatsapp` **et** traitement des messages ENTRANTS WhatsApp Business. Deux directions : (1) sortant — confirmation + avancement, comme SMS mais canal `WHATSAPP` ; (2) entrant — un client écrit à la banque pour **prendre un ticket** ou **consulter l'état**. La surface HTTP entrante (`/webhooks/whatsapp/inbound/{bankSlug}`) appartient déjà à CONTRACT-003 : cette story l'IMPLÉMENTE.

## Exigences (EARS)

### Sortant (avancement)
- **UBIQUITAIRE — opt-in STRICT** : aucun message WhatsApp sortant sans consentement `(bank_id, phone_hash, WHATSAPP)` valide (même règle que NOTIF-002). Absence → `FAILED / CONSENT_MISSING`. Note : un opt-in SMS ne vaut PAS opt-in WhatsApp (consentement **par canal**).
- **QUAND (WHEN) un ticket avec opt-in WhatsApp progresse** (confirmation, « vous êtes 3e », « le suivant »), le système doit enfiler le message sur `notifications:whatsapp` avec le template `(bank_id, type, WHATSAPP, lang)`, mêmes garanties de dédup et de fallback que NOTIF-002.
- **QUAND (WHEN) le webhook `POST /webhooks/notifications/whatsapp/delivery` reçoit un accusé** (CONTRACT-007, signature vérifiée → 401 sinon), le système met à jour le statut du journal par `provider_message_id`.

### Entrant (prise de ticket / consultation)
- **QUAND (WHEN) un message entrant arrive sur `/webhooks/whatsapp/inbound/{bankSlug}`**, le système doit vérifier la signature HMAC-SHA256 (`x-hub-signature-256`) avec le **secret propre à la banque** (routage tenant par `bankSlug`) → **401** si invalide, et NE JAMAIS traiter un message non signé.
- **QUAND (WHEN) un message entrant valide correspond à une intention « prendre un ticket »** (agence identifiée par la config WhatsApp de la banque + choix de service par menu/mot-clé), le système doit créer un ticket via le **cycle de vie API-003** (canal `WHATSAPP`, idempotent) et répondre par un message contenant `{{number}} {{position}} {{estimate}}`.
- **QUAND (WHEN) un message entrant valide correspond à une intention « état de mon ticket »**, le système doit répondre la position temps réel du ticket suivi (via `trackingId` ou dernier ticket actif du `phone_hash`).
- **ÉTAT (WHILE) l'expéditeur entrant n'a pas de consentement WhatsApp**, le premier message entrant vaut **opt-in explicite traçable** pour le canal WHATSAPP (l'utilisateur a initié la conversation) : le système enregistre `notification_consents (opted_in=true, opted_at=now)` avec source `INBOUND_WHATSAPP`, sans jamais présumer d'opt-in sur les autres canaux.
- **INDÉSIRABLE (IF…THEN)** : SI le `bankSlug` est inconnu ou l'agence non résolue ALORS le système répond une erreur opaque (pas de fuite de tenants existants) et NE crée AUCUN ticket.
- **INDÉSIRABLE (IF…THEN)** : SI le même message entrant est redélivré par WhatsApp (retries fournisseur) ALORS le traitement doit être idempotent par `provider_message_id` entrant → un seul ticket créé.
- **INDÉSIRABLE (IF…THEN)** : SI l'intention est ambiguë / non reconnue ALORS le système répond un message d'aide (menu FR/EN) sans créer de ticket.

## Critères d'acceptation

- [ ] `NOTIF-003: sortant sans opt-in WHATSAPP (même si opt-in SMS) → FAILED/CONSENT_MISSING (test)`
- [ ] `NOTIF-003: avancement WhatsApp → template WHATSAPP rendu, dédup + fallback identiques à SMS (test)`
- [ ] `NOTIF-003: inbound signature invalide → 401, aucun traitement (test)`
- [ ] `NOTIF-003: inbound bankSlug inconnu → erreur opaque, zéro ticket (test)`
- [ ] `NOTIF-003: inbound « prendre ticket » → ticket API-003 canal WHATSAPP + réponse position (test intégration)`
- [ ] `NOTIF-003: inbound redélivré (même provider_message_id) → un seul ticket (idempotence entrante) (test)`
- [ ] `NOTIF-003: inbound « état » → position temps réel du ticket du phone_hash (test)`
- [ ] `NOTIF-003: premier inbound → opt-in WHATSAPP tracé (source INBOUND_WHATSAPP), autres canaux inchangés (test)`
- [ ] `NOTIF-003: intention ambiguë → message d'aide FR/EN, zéro ticket (test)`
- [ ] `NOTIF-003: delivery webhook whatsapp → statut journal par provider_message_id (test)`

## Redécoupage

**Aucun redécoupage de couche.** Tout reste dans `apps/api` (worker sortant + handler webhook entrant + adaptateur WhatsApp Business). **Attention couture** : le webhook entrant appelle le service ticket d'API-003 — c'est une réutilisation, pas un nouvel endpoint métier. La NLU d'intention est volontairement **règles/mots-clés/menu** (pas d'IA — l'IA est F10) pour rester mono-couche et sans dépendance modèle.

## Hors scope

SMS (NOTIF-002) · email (NOTIF-004) · PWA/QR (NOTIF-005) · NLP/classification d'intention par modèle (F10) · édition des templates (CONTRACT-005) · infrastructure queue/DLQ (NOTIF-001).

## Hors scope DÉFINITIF (rappel constitution §5)

Pas de Core Banking / CRM / Mobile Money / USSD / biométrie / BCEAO. SIGFA 100% standalone. Langues **FR/EN uniquement**. Consentement WhatsApp traçable et **par canal**. Le webhook inbound existe déjà au contrat (CONTRACT-003) ; les nouveaux types/champs (source de consentement `INBOUND_WHATSAPP`, config WhatsApp par banque : numéro business, secret, mapping menu→service) requièrent un additif contrat — voir `_notes.md`.
