# NOTIF-004 : Email Resend + React Email — rapports, alertes manager

**Module** : F6 — Notifications & Jobs · **Agent** : agent-api · **Dépend de** : NOTIF-001 (infrastructure de jobs) · **Statut** : TODO

> Consommateur de la queue `notifications:email`. Rendu d'e-mails via **React Email** (templates typés, versionnables) et envoi via **Resend**. Deux usages : (1) rapports (planification et contenu métier détaillés = REP-002/F7 — ici on fournit le **canal d'envoi** et les templates de transport) ; (2) alertes manager (SLA dépassé, borne muette, erreur système borne). L'email vise des **destinataires internes** (staff : managers, directeurs, COMEX) — pas les clients finaux — donc **pas** d'opt-in UEMOA SMS/WhatsApp ; le régime de consentement est celui des utilisateurs internes.

## Exigences (EARS)

- **UBIQUITAIRE — destinataires internes only** : le canal email ne doit adresser QUE des utilisateurs de la banque (rôle ≥ défini par le type d'email), jamais un client final. Aucune adresse email de client n'est stockée ni utilisée (les clients sont joints par SMS/WhatsApp/PWA uniquement).
- **UBIQUITAIRE — rendu typé** : chaque type d'email (`MANAGER_ALERT`, `DAILY_REPORT`, `WEEKLY_REPORT`, `MONTHLY_REPORT`) doit être un composant React Email avec des **props typées** ; le worker refuse d'envoyer si les props ne valident pas (Zod), plutôt que de produire un HTML cassé.
- **QUAND (WHEN) une alerte manager est déclenchée** (ex. SLA systématiquement dépassé, borne muette — sources API-007/API-011/ADM-003), le système doit enfiler un job `notifications:email` de type `MANAGER_ALERT` rendu React Email, destiné aux managers de l'agence concernée.
- **QUAND (WHEN) un producteur de rapport (F7/REP-002) demande un envoi**, le système doit accepter un payload {type, destinataires internes, pièces jointes optionnelles (PDF/Excel générés en amont), variables} et l'enfiler ; NOTIF-004 ne calcule PAS les KPIs (c'est REP-001/REP-002), il transporte.
- **QUAND (WHEN) Resend accepte l'envoi (2xx)**, le worker doit passer `notification_log.status = SENT` + `provider_message_id` ; l'accusé `DELIVERED`/bounce arrive par le webhook `POST /webhooks/notifications/resend/delivery` (CONTRACT-007, signature vérifiée → 401 sinon).
- **ÉTAT (WHILE) une pièce jointe dépasse la limite Resend** (ou le total dépasse le plafond documenté), le système doit basculer sur un **lien de téléchargement signé à durée limitée** au lieu de la pièce jointe, et le noter dans le log.
- **INDÉSIRABLE (IF…THEN)** : SI Resend renvoie un bounce dur (adresse invalide) ALORS le système doit marquer `FAILED / EMAIL_BOUNCED` et lever une alerte de configuration (ne pas réessayer indéfiniment un bounce dur).
- **INDÉSIRABLE (IF…THEN)** : SI Resend renvoie 429 / erreur transitoire ALORS le job suit le retry/backoff de NOTIF-001.
- **INDÉSIRABLE (IF…THEN)** : SI la liste de destinataires internes résolue est vide ALORS le job échoue proprement (`FAILED / NO_RECIPIENT`) sans envoi.

## Critères d'acceptation

- [ ] `NOTIF-004: canal email n'adresse que des utilisateurs internes — email client refusé (test)`
- [ ] `NOTIF-004: props React Email invalides (Zod) → refus d'envoi, aucun HTML cassé (test)`
- [ ] `NOTIF-004: alerte manager → job MANAGER_ALERT enfilé vers managers de l'agence (test)`
- [ ] `NOTIF-004: producteur rapport → payload {type,destinataires,pièces,variables} accepté et enfilé (test) ; aucun calcul KPI ici`
- [ ] `NOTIF-004: 2xx Resend → SENT + provider_message_id ; DELIVERED/bounce via webhook (test adaptateur mocké)`
- [ ] `NOTIF-004: webhook resend signature invalide → 401 ; valide → statut journal mis à jour (test)`
- [ ] `NOTIF-004: pièce jointe hors limite → lien signé temporaire à la place, noté au log (test)`
- [ ] `NOTIF-004: bounce dur → FAILED/EMAIL_BOUNCED, pas de retry infini + alerte config (test)`
- [ ] `NOTIF-004: 429/erreur transitoire → retry/backoff NOTIF-001 (test)`
- [ ] `NOTIF-004: destinataires vides → FAILED/NO_RECIPIENT, aucun envoi (test)`
- [ ] `NOTIF-004: snapshot de rendu React Email FR + EN par type (régression) (test)`

## Redécoupage

**Aucun redécoupage.** Story mono-couche `apps/api` (worker email + templates React Email + adaptateur Resend + webhook handler). Le **contenu métier** des rapports (KPIs, agrégats, mise en page 1 page COMEX) appartient à REP-001/REP-002 (F7) qui **produisent** vers ce canal — frontière nette : F6 = transport/rendu de transport, F7 = données. Les templates React Email (JSX) vivent dans `apps/api` (pas dans `apps/web`) car ils sont rendus côté serveur au moment de l'envoi.

## Hors scope

Calcul des KPIs / agrégats / contenu des rapports (REP-001, REP-002 — F7) · SMS (NOTIF-002) · WhatsApp (NOTIF-003) · PWA/QR (NOTIF-005) · planification cron des rapports (REP-002) · infrastructure queue/DLQ (NOTIF-001).

## Hors scope DÉFINITIF (rappel constitution §5)

Pas de Core Banking / CRM / Mobile Money / USSD / biométrie / BCEAO. SIGFA 100% standalone. Langues **FR/EN uniquement** (templates email FR + EN). Aucun email de client final (clients = SMS/WhatsApp/PWA). Le webhook `resend/delivery` existe déjà au contrat (CONTRACT-007) ; l'éventuel type `MANAGER_ALERT` et le lien signé de pièce jointe requièrent un additif — voir `_notes.md`.
