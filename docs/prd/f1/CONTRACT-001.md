# CONTRACT-001 : Contrat cœur — tenants, auth, agences, services, guichets, files, tickets

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : INFRA-005 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/core.yaml` (+ `.spectral.yaml` partagé, créé ici)
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)

## Exigences (EARS)

- Le contrat doit définir toutes les ressources cœur en OpenAPI 3.1 sous `/api/v1` : **Auth** (`POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`), **Banks** (`GET/POST /banks` [platform, SUPER_ADMIN], `GET/PATCH /banks/:id`), **Agencies** (`GET/POST /agencies`, `GET/PATCH/DELETE /agencies/:id`), **Services** (`GET/POST /services`, `PATCH /services/:id`), **Counters** (`GET/POST /counters`, `PATCH /counters/:id`), **Queues** (`GET /queues?agencyId=`, `PATCH /queues/:id`), **Tickets** (`POST /tickets` †, `GET /tickets/:id`, `POST /counters/:counterId/call-next`, `POST /tickets/:id/call`, `/serve`, `/close` †, `/no-show`, `/transfer`, `/abandon`, `POST /tickets/sync` †).
- **Appel du suivant (sélection serveur)** : `POST /counters/:counterId/call-next` — le serveur sélectionne le prochain ticket selon les priorités du moteur de file (API-004) → 200 (ticket passé CALLED) ; SI aucun ticket WAITING éligible, ALORS **404 `QUEUE_EMPTY`** (avec exemple). `POST /tickets/:id/call` reste l'appel CIBLÉ (re-appel, ticket précis) → 409 `TICKET_ALREADY_CLAIMED` si un autre guichet l'a déjà obtenu.
- Le contrat doit définir pour CHAQUE endpoint les 9 réponses avec le schéma d'erreur standard référencé, le scope (`x-tenant-scope`) et le rôle minimal (`x-required-role`, matrice v5 §MODULE 4).
- QUAND une mutation est critique († : émission, clôture, sync), le contrat doit exiger `X-Idempotency-Key` (format et sémantique : conventions `_dag.md`, schéma unique `components/headers/IdempotencyKey`).
- La **machine à états du ticket** doit être encodée : enum `TicketStatus` (`WAITING → CALLED → SERVING → DONE | NO_SHOW | ABANDONED | TRANSFERRED`), transitions légales décrites par endpoint, transition illégale → 409 `ILLEGAL_TRANSITION`.
- `POST /tickets/sync` : batch de tickets locaux **limité à 100** (`maxItems: 100`, 422 `BATCH_TOO_LARGE` au-delà), idempotence par uuid client, réponse `{ synced: [{localUuid, serverId, number}], skipped: [{localUuid, reason}] }` (résolution numéros locaux → définitifs).
- Les réponses d'émission doivent inclure `number`, `position`, `estimatedWaitMinutes`.
- Auth : JWT access 15 min + refresh 7 j rotation dans `components/securitySchemes` ; 429 sur `/auth/login` (5 tentatives/15 min).
- core.yaml doit posséder les **schémas transverses** : `TicketStatus`, `Role` (6 rôles + NONE), `NotificationType` (référencés par 002–008 — conventions `_dag.md`).
- La story crée `.spectral.yaml` avec : 9 codes obligatoires → error ; endpoint sans exemple → error ; **règles custom** validant les enums `x-required-role` / `x-tenant-scope` sur chaque opération → error ; schéma inline dupliqué → warning.

## Critères d'acceptation

- [ ] `CONTRACT-001: le YAML est valide OpenAPI 3.1 (spectral lint zéro erreur, règles custom x-* incluses)`
- [ ] `CONTRACT-001: chaque endpoint expose les 9 codes de réponse avec schéma (test parcourant le YAML)`
- [ ] `CONTRACT-001: chaque route documente x-tenant-scope + x-required-role, valeurs dans les enums (test spectral custom)`
- [ ] `CONTRACT-001: les 3 mutations critiques référencent components/parameters/IdempotencyKeyParam (schema inline) — components/headers/IdempotencyKey conservé pour la sémantique (test)` *(texte aligné post-amendement ts-nocheck)*
- [ ] `CONTRACT-001: machine à états encodée — enum TicketStatus + 409 ILLEGAL_TRANSITION sur chaque transition (test)`
- [ ] `CONTRACT-001: call-next → 200 | 404 QUEUE_EMPTY documentés avec exemples ; /call → 409 TICKET_ALREADY_CLAIMED (test)`
- [ ] `CONTRACT-001: sync — maxItems 100 + 422 BATCH_TOO_LARGE + réponse synced/skipped typée (test)`
- [ ] `CONTRACT-001: chaque endpoint possède exemple requête + réponse valides (spectral) — le smoke Prism global est délégué à CONTRACT-009b`

## Hors scope
Implémentation (F3) · événements (CONTRACT-002) · surface publique, session borne, **feedback client → CONTRACT-003 exclusivement** (jamais dans core.yaml) · profils agents (CONTRACT-004) · admin/config (CONTRACT-005) · génération (CONTRACT-009).
