# F6 — NOTIFICATIONS & JOBS — Notes de convergence (matière orchestrateur)

Questions ouvertes, risques de faisabilité, ambiguïtés à trancher et ajouts de contrat nécessaires. Alimente les 3 critiques (completeness / ambiguity / feasibility) avant dispatch.

---

## 1. Ajouts de contrat nécessaires (API-First — CONTRACT amont = racine du DAG)

Toute route/événement/type ci-dessous **doit d'abord passer par une story CONTRACT** (agent-contract) avant implémentation F6. La plupart sont des **additifs non-breaking** à CONTRACT-007 / CONTRACT-003 / CONTRACT-005.

| # | Ajout | Contrat cible | Nature | Story F6 concernée |
|---|---|---|---|---|
| C1 | Types de message `POSITION_NEAR` (« vous êtes 3e ») et `POSITION_NEXT` (« le suivant ») dans l'enum `NotificationType` | CONTRACT-007 (via core.yaml $ref) | Additif enum | NOTIF-002, NOTIF-003 |
| C2 | Config banque : seuil `smsNearThreshold` (défaut 3) déclenchant `POSITION_NEAR` | CONTRACT-005 (config banque) + CONTRACT-007 | Additif champ config | NOTIF-002, NOTIF-003 |
| C3 | Source de consentement `INBOUND_WHATSAPP` sur l'opt-in (traçabilité : opt-in créé par message entrant) | CONTRACT-007 (`/notifications/opt-in`) | Additif enum source | NOTIF-003 |
| C4 | Config WhatsApp Business par banque : numéro business, secret webhook, mapping menu/mot-clé → service | CONTRACT-005 | Nouveau bloc config | NOTIF-003 |
| C5 | Type `MANAGER_ALERT` (email interne) + variantes de rapport `DAILY/WEEKLY/MONTHLY_REPORT` si pas déjà dans `NotificationType` | CONTRACT-007 | Additif enum | NOTIF-004 |
| C6 | Lien de téléchargement signé (pièce jointe email hors limite Resend) : endpoint ou champ de réponse | CONTRACT-006/007 | À trancher | NOTIF-004 |
| C7 | Format du `signedAgencyToken` du QR (algo HMAC/JWS, TTL, rotation de clé, versionnement) | CONTRACT-003 (`GET /agencies/:id/qr` renvoie déjà « identifiant agence signé » — format non spécifié) | Précision de champ | NOTIF-005-A |
| C8 | Extension `GET /health` pour exposer la santé des queues BullMQ (getQueueHealth) | CONTRACT-001/007 (API-011 possède /health) | Additif champ `checks` | NOTIF-001 |

**Webhooks déjà au contrat (RAS)** : `POST /webhooks/notifications/{provider}/delivery` (africastalking|whatsapp|resend) = CONTRACT-007 ✅ ; `POST /webhooks/whatsapp/inbound/{bankSlug}` = CONTRACT-003 ✅. NOTIF-002/003/004 les **implémentent** sans nouvel endpoint.

---

## 2. Risques de faisabilité

### Dépendance fournisseur / disponibilité
- **Africa's Talking (SMS)** : couverture opérateurs CI (Orange/MTN/Moov) et **fenêtres de délivrabilité variables**. Risque : accusés `DELIVERED` tardifs ou absents selon opérateur → le journal peut rester en `SENT` sans jamais passer `DELIVERED`. À trancher : définit-on un TTL au-delà duquel `SENT` sans accusé est considéré « delivery inconnu » ?
- **WhatsApp Business (Meta)** : nécessite un **numéro business vérifié + templates pré-approuvés par Meta** pour les messages sortants initiés par l'entreprise (HSM). Risque MAJEUR : les templates de progression (« vous êtes 3e ») doivent être **approuvés à l'avance** par Meta, par langue — le fallback template libre n'est pas autorisé hors fenêtre de service 24h. Impact direct sur NOTIF-003 (rendu de templates) : le fallback banque→FR global peut être bloqué côté Meta.
- **Resend (email)** : plafond de pièces jointes → d'où le repli lien signé (C6). Domaine émetteur à configurer (SPF/DKIM/DMARC) par banque pour éviter les bounces / spam.

### Coûts / quotas
- SMS et WhatsApp sont **facturés à l'unité** ; les 3 messages/ticket (confirmation + near + next) × volume (100 tickets/min/agence × 50 agences en cible k6, SEC-004) = coût significatif. À trancher : quotas par banque, opt-out facile, et **suppression du message `POSITION_NEAR` si `POSITION_NEXT` suit de trop près** (éviter 2 SMS coûteux à 30 s d'écart).
- Rate-limits fournisseur : les queues par canal (NOTIF-001) doivent être **throttlées au débit fournisseur** (limiter le concurrency BullMQ par queue) pour ne pas se faire bannir. Valeur de concurrency = paramètre d'environnement.

### Technique
- **Workers hors RLS** : les workers BullMQ tournent hors requête HTTP → pas de `SET app.current_bank_id` de session. Le `bank_id` du job est LA source de vérité et doit être vérifié applicativement (NOTIF-001, garde tenant worker). À valider avec agent-database : faut-il ouvrir une connexion en positionnant explicitement le tenant dans le worker ?
- **Déchiffrement du téléphone dans le worker** (DB-008) : le clair n'existe qu'en mémoire, le temps de l'appel fournisseur. Risque de fuite en logs/DLQ → interdiction stricte (couverte par les critères NOTIF-002).
- **Idempotence de position** : `POSITION_NEAR`/`POSITION_NEXT` déclenchés sur événement de file. Si la position oscille (transfert, réinsertion), garantir « une fois par ticket par type » via `dedupe_key` — OK, mais que faire si le ticket **recule** puis re-atteint le seuil ? Décision proposée : un seul envoi par (ticket,type) à vie, pas de renvoi.

---

## 3. Ambiguïtés à trancher

1. **Multilingue** : MEMORY dit **FR/EN uniquement** (Dioula/Baoulé retirés par le PO), mais DB-005/PRD historique mentionnent 4 langues (`lang fr/dioula/baoule/en`). → **Trancher** : les templates F6 ne rendent que FR/EN ; l'enum `lang` en base peut rester large mais F6 ne seed/rend que FR+EN. À confirmer avec agent-database pour éviter des templates orphelins.
2. **Confirmation par défaut** : envoie-t-on TOUJOURS la confirmation si opt-in, ou seulement à la demande ? Proposé : oui si téléphone + opt-in (valeur produit). À valider PO.
3. **PWA (NOTIF-005-B)** : appartient-elle à F6 ou aux vagues clients (F4 mock / F5 bascule) ? Redécoupage effectué → **volet B = story `agent-web` séparée**, probablement rattachée à F4/F5. L'orchestrateur doit décider du rattachement de vague.
4. **WhatsApp inbound « prendre un ticket »** : par quel mécanisme le client choisit le service ? Menu numéroté ? Mots-clés ? → dépend de C4 (config mapping). Volontairement **sans IA** (règles) pour rester mono-couche ; l'IA d'intention est F10.
5. **Opt-in WhatsApp par message entrant** : traiter le premier message entrant comme opt-in explicite (l'utilisateur a initié) est juridiquement défendable UEMOA, mais à **valider conformité** — tracer source `INBOUND_WHATSAPP` (C3).
6. **DELIVERED sans webhook** : certains fournisseurs n'envoient jamais d'accusé final. Politique de « statut terminal inconnu » à définir (cf. risque Africa's Talking).

---

## 4. DAG interne F6

```
API-003 (DONE) ──► NOTIF-001 ──┬─► NOTIF-002 (─ DB-005) ──► NOTIF-003
                               ├─► NOTIF-004
                               └─(indépendant)
CONTRACT-003 + API-003 ─────────► NOTIF-005-A ─(contrat QR)─► NOTIF-005-B (agent-web, F4/F5)
```

- NOTIF-002 et NOTIF-004 parallélisables (fichiers workers distincts).
- NOTIF-003 dépend de NOTIF-002 (réutilise worker/opt-in/templates).
- NOTIF-005-A indépendant de NOTIF-001 (pas de queue — c'est de l'émission synchrone + QR signé).

## 5. Rappel hors-scope DÉFINITIF (constitution §5)

Aucun Core Banking / CRM / Mobile Money / USSD / biométrie / BCEAO. SIGFA 100% standalone. Pas d'app mobile cliente (clients = SMS/WhatsApp/PWA web). FR/EN uniquement. Consentement traçable, droit à l'oubli déjà en DB-005/DB-008.
