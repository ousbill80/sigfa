# CONTRACT-007 : Contrat notifications — SMS, WhatsApp, email, push, devices, opt-in

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/notifications.yaml` ($ref vers core.yaml)
**Révision** : v2 — amendée après critique (Boucle 1, itération 1 — ajout devices push)

## Exigences (EARS)

- **Journal d'envoi** : `GET /notifications/log?ticketId=&channel=&status=` — canaux `SMS | WHATSAPP | EMAIL | PUSH`, statuts `QUEUED | SENT | DELIVERED | FAILED` (+ `failureReason` énuméré), pagination ; les téléphones apparaissent UNIQUEMENT via le champ `phoneNumberMasked` — **règle de masquage** : 2 premiers + 2 derniers chiffres visibles, groupes intermédiaires remplacés par `••` (ex. `07 •• •• •• 47`), calculé côté serveur.
- **Devices push (MAJOR intégré)** : `POST /notifications/devices` `{ deviceToken, platform: IOS | ANDROID | EXPO }` → 201 `{ deviceId }` (idempotent : même token → 200 même deviceId) ; `DELETE /notifications/devices/:deviceId` — prérequis contractuel de MOB-004.
- **Opt-in/opt-out** : `POST /notifications/opt-in` et `/opt-out` par téléphone + canal ; UBIQUITAIRE — aucun envoi SMS/WhatsApp sans opt-in explicite préalable (UEMOA) ; `GET /notifications/consent?phone=` (MANAGER+, réponse minimale).
- **Test d'envoi** : `POST /notifications/test` (BANK_ADMIN — canal + template + destinataire de la liste de test de la banque uniquement, sinon 422).
- Les **types de messages** réutilisent l'enum `NotificationType` de core.yaml ($ref — confirmation, « vous êtes 3e », « vous êtes le suivant », rapport quotidien…) + payload de variables par type.
- **Webhooks fournisseurs (accusés SORTANTS)** : `POST /webhooks/notifications/{provider}/delivery` (`provider: africastalking | whatsapp | resend`) — signature vérifiée par provider (401 si invalide), met à jour le statut du journal. (Les messages WhatsApp ENTRANTS sont CONTRACT-003 `/webhooks/whatsapp/inbound/{bankSlug}`.)

## Critères d'acceptation

- [ ] `CONTRACT-007: spectral zéro erreur ; $ref core résolus (test bundle redocly)`
- [ ] `CONTRACT-007: phoneNumberMasked seul champ téléphone de TOUS les schémas de réponse (test structurel)`
- [ ] `CONTRACT-007: devices — 201/200 idempotent + DELETE (test)`
- [ ] `CONTRACT-007: opt-in requis encodé + endpoints consent (test)`
- [ ] `CONTRACT-007: NotificationType référencé depuis core.yaml, jamais redéfini (test)`
- [ ] `CONTRACT-007: webhooks delivery par provider avec 401 signature invalide (test)`
- [ ] `CONTRACT-007: 9 codes + scope + rôle partout ; exemples valides (spectral) — smoke Prism délégué à CONTRACT-009b`

## Hors scope
Implémentation BullMQ/envois (F6) · édition des templates (CONTRACT-005) · tables (DB-005) · webhook WhatsApp entrant (CONTRACT-003).
