# MODEL-API-B : API conseiller — liste publique + marquage + file par conseiller (priorité absolue)

**Module** : MODÈLE (Phase B) · **Agent** : agent-api · **Dépend de** : CONTRACT-B (DONE), DB-B (DONE), API-A (DONE) · **Statut** : TODO

**Révision** : v2 — arbitrage `_arbitrage.md` (D5, D6). Conforme à LA LOI (CONTRACT-B) + schéma (DB-B).

## Exigences (EARS)
- **Liste publique NOMINATIVE** : `GET /public/agencies/{agencyId}/relationship-managers` (role NONE) → **UNIQUEMENT `{ id, displayName, photoUrl? }`** des users `is_relationship_manager AND is_active AND deleted_at IS NULL` de l'agence. **ZÉRO PII** (jamais email/rôle/téléphone). Scope agence.
- **Marquage conseiller (admin)** : `PATCH /agents/{id}` accepte `isRelationshipManager`/`displayName`/`photoUrl` (RBAC AGENCY_DIRECTOR sur son agence), audit branché.
- **Ticket ciblant un conseiller** : à la création (`POST /tickets`, `POST /public/tickets`, sync), SI `targetManagerId` fourni → valider que c'est un **conseiller actif de l'agence** → poser `tickets.target_manager_id`. Sinon → 404 `RELATIONSHIP_MANAGER_NOT_FOUND` (opaque en public). Le ticket rejoint la **file personnelle** du conseiller (pas de nouvelle file — filtre `target_manager_id`). `serviceId`/`operationId` restent gérés comme Phase A.
- **Moteur de file — file conseiller PRIORITÉ ABSOLUE (D6)** : nouvelle stratégie `selectNextForManager` (TicketSelector injectable). QUAND un agent conseiller fait `call-next`, il sert **D'ABORD sa file perso** (tickets `target_manager_id = lui`, ordre priorité porteur puis FIFO), et **SEULEMENT si elle est vide** la file de service (comportement existant). Règle testable : file perso non vide → sert perso ; file perso vide → sert service. `selectNextPriority`/`selectNextFifo` existants réutilisés pour l'ordonnancement interne.
- **ALIGNER les ~22 fixtures DDL inline** (couture DB-B) : ajouter les 3 colonnes `users` (`is_relationship_manager`/`display_name`/`photo_url`) + `tickets.target_manager_id` dans les fixtures listées (priorité : `admin-test-harness.ts`, DDL central) → les tests api restent verts.

## Critères d'acceptation
- [ ] `MODEL-API-B: GET .../relationship-managers → {id,displayName,photoUrl?} zéro PII, conseillers actifs de l'agence uniquement`
- [ ] `MODEL-API-B: PATCH /agents/{id} marque conseiller (RBAC + audit) ; ticket avec targetManagerId → target_manager_id posé ; inconnu/non-conseiller → 404 RELATIONSHIP_MANAGER_NOT_FOUND`
- [ ] `MODEL-API-B: selectNextForManager — conseiller sert d'abord sa file perso, puis service quand vide (test de priorité absolue D6)`
- [ ] `MODEL-API-B: ~22 fixtures inline alignées (users cols + target_manager_id) → tests api verts, zéro régression`
- [ ] `MODEL-API-B: Schemathesis (relationship-managers + agents) PASS ; tenant-isolation (conseiller/ticket cross-agence → refus) ; gate sérialisé vert`

## Hors scope
UI (KIOSK-B/WEB-B) · contrat (CONTRACT-B DONE) · schéma (DB-B DONE) · rendez-vous/mobile (ANNULÉ).
