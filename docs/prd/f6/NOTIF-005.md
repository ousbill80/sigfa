# NOTIF-005 : QR code agence → PWA ticket mobile navigateur (SANS app)

**Module** : F6 — Notifications & Jobs (volet API) + F4/F5 (volet PWA) · **Agent** : agent-api (volet A) + agent-web (volet B) · **Dépend de** : CONTRACT-003 (`GET /agencies/:id/qr`, suivi public, émission canal `QR`), API-003 (cycle de vie ticket) · **Statut** : TODO

> Le client scanne un QR affiché en agence → ouvre une **PWA dans le navigateur mobile** (aucune installation d'app, cf. décision PO « pas d'app mobile cliente ») → prend un ticket et suit sa position en temps réel/quasi-réel. **Cette story mélange deux couches** (backend QR + web PWA) : elle est **REDÉCOUPÉE** ci-dessous en deux stories mono-couche. Ce fichier tient lieu d'épopée + volet A (API) ; le volet B (PWA) est décrit et devra vivre comme story `agent-web` dédiée.

## Redécoupage (obligatoire — §4 constitution : une story = une couche = un agent)

- **NOTIF-005-A (agent-api)** — Payload QR signé + surface d'émission/suivi canal `QR`. Implémente `GET /agencies/:id/qr` (déjà au contrat CONTRACT-003) : renvoie l'URL PWA + identifiant agence **signé** (jeton court, non-PII, anti-forge). Garantit que l'émission via canal `QR` (POST /tickets, API-003) et le suivi public (`GET /public/tickets/:trackingId`, headers de cache/ETag) fonctionnent pour la PWA. **Périmètre `apps/api` uniquement.**
- **NOTIF-005-B (agent-web)** — La **PWA** elle-même (manifest, service worker, écrans prendre-ticket + ticket vivant) servie en navigateur mobile, consommant le mock puis l'API réelle (API-First). **Périmètre `apps/web` (ou app PWA dédiée) uniquement.** Relève des vagues clients (F4 mock / F5 bascule) plus que de F6 ; noté pour l'orchestrateur. **N'introduit aucune route** — consomme le contrat existant.

Le présent fichier détaille surtout **NOTIF-005-A**. Le volet B est spécifié en exigences « PWA » pour cadrage, à sortir en story `WEB-0xx` par l'orchestrateur.

## Exigences (EARS) — Volet A (agent-api)

- **UBIQUITAIRE — QR non-PII et signé** : le payload du QR ne doit contenir AUCUNE donnée personnelle ; l'identifiant agence est **signé** (HMAC/JWS court, TTL raisonnable ou versionné) pour empêcher un QR forgé de pointer une autre agence/tenant.
- **QUAND (WHEN) `GET /agencies/:id/qr` est appelé** (rôle selon CONTRACT-003), le système doit renvoyer `{ url, signedAgencyToken }` (URL PWA + jeton) ; l'agence doit être `is_active` et non supprimée, sinon 404 opaque.
- **QUAND (WHEN) la PWA émet un ticket avec le jeton signé** (canal `QR`, API-003), le système doit vérifier la signature du jeton, résoudre l'agence/tenant, créer le ticket **idempotemment** (`X-Idempotency-Key`) et renvoyer `{number, position, estimate, trackingId}`.
- **ÉTAT (WHILE) le réseau du client est instable**, le suivi public doit rester consommable via les **headers de cache** `Cache-Control: max-age=30` + `ETag` (déjà au contrat CONTRACT-003) pour que le service worker de la PWA serve un état récent.
- **INDÉSIRABLE (IF…THEN)** : SI le jeton QR est expiré/altéré/d'un autre tenant ALORS l'émission est refusée (401/403 opaque) et aucun ticket n'est créé.
- **INDÉSIRABLE (IF…THEN)** : SI le téléphone est fourni dans la PWA ALORS `smsConsent` explicite est requis (opt-in UEMOA) — mais le téléphone reste **facultatif** (le suivi PWA fonctionne sans, via `trackingId`).

## Exigences (EARS) — Volet B (agent-web, PWA — cadrage pour story WEB dédiée)

- **UBIQUITAIRE** : la PWA doit fonctionner **en navigateur mobile sans installation d'app** ; installable optionnellement (manifest) mais jamais requise ; aucune dépendance store.
- **QUAND (WHEN) le QR est scanné**, la PWA doit ouvrir un parcours **3 étapes** aligné sur le kiosque (langue FR/EN → service → confirmation) et afficher le **ticket vivant** (numéro, position temps réel, attente estimée).
- **ÉTAT (WHILE) hors ligne**, la PWA doit afficher le dernier état connu du ticket (service worker + cache) et resynchroniser à la reconnexion.
- **INDÉSIRABLE (IF…THEN)** : SI l'API/mock est injoignable au chargement ALORS la PWA affiche un état d'erreur humain (pas d'écran blanc), conforme aux 5 états design.

## Critères d'acceptation

### Volet A (agent-api)
- [ ] `NOTIF-005-A: GET /agencies/:id/qr → {url, signedAgencyToken} ; agence inactive → 404 opaque (test)`
- [ ] `NOTIF-005-A: payload QR sans PII ; jeton signé vérifiable ; jeton forgé → refus (test)`
- [ ] `NOTIF-005-A: émission canal QR avec jeton valide → ticket idempotent + trackingId (test intégration)`
- [ ] `NOTIF-005-A: jeton expiré/altéré/autre tenant → 401/403 opaque, zéro ticket (test)`
- [ ] `NOTIF-005-A: téléphone fourni sans smsConsent → refus opt-in ; téléphone omis → suivi par trackingId OK (test)`
- [ ] `NOTIF-005-A: suivi public renvoie Cache-Control max-age=30 + ETag (test contrat)`
- [ ] `NOTIF-005-A: Schemathesis PASS sur /agencies/:id/qr et émission canal QR`

### Volet B (agent-web — story WEB dédiée)
- [ ] `NOTIF-005-B: PWA s'ouvre en navigateur mobile sans installation (manifest présent, non requis)`
- [ ] `NOTIF-005-B: parcours 3 étapes FR/EN → ticket vivant avec position temps réel (test composant + E2E)`
- [ ] `NOTIF-005-B: offline → dernier état connu affiché, resync à la reconnexion (test service worker)`
- [ ] `NOTIF-005-B: API/mock injoignable → état d'erreur humain, 5 états design respectés`

## Hors scope

Application mobile native / store (INTERDIT — décision PO, pas d'app cliente) · rendez-vous (ANNULÉ) · SMS/WhatsApp/email (NOTIF-002/003/004) · infrastructure queue (NOTIF-001) · impression matérielle · calcul de position (API-003).

## Hors scope DÉFINITIF (rappel constitution §5)

Pas de Core Banking / CRM / Mobile Money / USSD / biométrie / BCEAO. SIGFA 100% standalone. **Pas d'app mobile cliente** : clients suivis par SMS + web public/PWA uniquement (`apps/mobile` hors périmètre produit). Langues **FR/EN uniquement**. Le QR endpoint et le canal `QR` existent déjà au contrat (CONTRACT-003) ; le format exact du `signedAgencyToken` (algorithme, TTL, rotation) requiert un additif contrat — voir `_notes.md`.
