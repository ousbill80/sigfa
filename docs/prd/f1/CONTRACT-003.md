# CONTRACT-003 : Contrat client public — émission multi-canal, suivi, feedback, session et heartbeat borne

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/public.yaml` ($ref vers core.yaml)
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)

## Exigences (EARS)

- **Frontière avec CONTRACT-001** : core.yaml possède `/tickets/*` (hors feedback) ; public.yaml possède la SURFACE D'ACCÈS client + borne — il référence les schémas de core, ne redéfinit aucun endpoint de core. **Le feedback appartient à cette story exclusivement.**
- **Session borne** : `POST /kiosk/session` (credentials dédiés par borne → JWT scope agency, **TTL 12 heures, non renouvelable par refresh**) ; révocation : `DELETE /kiosk/session/:kioskId` (AGENCY_DIRECTOR+). Toutes les routes borne exigent ce token.
- **Heartbeat borne** : `POST /kiosks/:kioskId/heartbeat` `{ printerStatus: OK|ERROR|OFFLINE, appVersion, uptimeSeconds }` → 200 `{ serverTime }` (token session borne) — alimente `lastSeen` et `printerStatus` de la supervision (CONTRACT-006) et l'événement `kiosk:printer-error` (CONTRACT-002).
- **Émission par canal** : réutilise `POST /tickets` (core) avec `channel: KIOSK | QR | MOBILE | WHATSAPP` (discriminator/oneOf par canal, champs conditionnels documentés) ; téléphone **explicitement facultatif** sur borne ; `smsConsent` booléen obligatoire si téléphone fourni (opt-in UEMOA).
- **Suivi public** : `GET /public/tickets/:trackingId` — `trackingId` = **nanoid(21)** (`^[A-Za-z0-9_-]{21}$`), généré à l'émission, stocké en colonne indexée, distinct de l'uuid interne qui n'apparaît dans AUCUNE réponse publique. Sans auth, rate-limité (429 documenté), avec **headers de cache** (`Cache-Control: max-age=30`, `ETag`) pour le Service Worker en réseau instable.
- **Feedback** : `POST /public/tickets/:trackingId/feedback` (note 1–5 entière, commentaire ≤500 caractères optionnel) ; 422 `TICKET_NOT_CLOSED` si le ticket n'est pas DONE ; 409 `FEEDBACK_ALREADY_SUBMITTED` si doublon ; 422 `FEEDBACK_WINDOW_EXPIRED` au-delà de 24 h après clôture.
- **Webhook WhatsApp entrant** : `POST /webhooks/whatsapp/inbound/{bankSlug}` — routage tenant par `bankSlug`, signature HMAC-SHA256 (`x-hub-signature-256`) vérifiée avec le **secret propre à la banque** → 401 si invalide. Message entrant → création de ticket ou consultation d'état. (Les accusés de livraison SORTANTS sont CONTRACT-007.)
- **QR d'agence** : `GET /agencies/:id/qr` → payload du QR (URL PWA + identifiant agence signé).

## Critères d'acceptation

- [ ] `CONTRACT-003: spectral zéro erreur ; $ref croisés vers core.yaml résolus (test bundle redocly)`
- [ ] `CONTRACT-003: 9 codes + x-tenant-scope (public|agency) sur chaque endpoint (test)`
- [ ] `CONTRACT-003: canal encodé en oneOf/discriminator avec champs conditionnels par canal (test)`
- [ ] `CONTRACT-003: trackingId pattern nanoid(21) ; uuid interne absent de toutes les réponses publiques (test structurel)`
- [ ] `CONTRACT-003: session borne TTL 12 h + révocation ; heartbeat typé avec printerStatus (test)`
- [ ] `CONTRACT-003: feedback — 422 TICKET_NOT_CLOSED, 409 doublon, 422 fenêtre expirée documentés (test)`
- [ ] `CONTRACT-003: webhook inbound par bankSlug avec 401 signature invalide (test)`
- [ ] `CONTRACT-003: Cache-Control + ETag documentés sur le suivi public (test)`
- [ ] `CONTRACT-003: exemples présents + valides par canal (spectral) — smoke Prism délégué à CONTRACT-009b`

## Hors scope
Envoi SMS/WhatsApp sortant et accusés (CONTRACT-007) · PWA/UI (F4) · logique offline borne (KIOSK-006) · impression matérielle.
