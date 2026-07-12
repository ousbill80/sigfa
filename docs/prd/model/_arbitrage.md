# Arbitrage — VAGUE MODÈLE (Services · Opérations · Conseillers) · Boucle 1

**Verdicts** : ambiguity → AMBIGUOUS (6 BLOCKER) · completeness → GAPS (4 BLOCKER + 6 MAJOR) · feasibility → **FEASIBLE (0 BLOCKER)**. Convergence : rien d'irréalisable ; les blockers sont des DÉCISIONS à figer. Table exécutoire ci-dessous (appliquée au design en v2).

## Décisions exécutoires

**D1 — Rétrocompat contrat & DB (opération ADDITIVE, non-breaking).** `tickets.service_id` **CONSERVÉ** (NOT NULL, dénormalisé). On **AJOUTE `tickets.operation_id` NULLABLE** (FK `operations`). Contrat : `operationId` **ajouté OPTIONNEL** aux corps de création ; `serviceId` **reste required** → oasdiff vert (`--fail-on ERR` passe). Résolution API : `operationId` fourni → `service_id` dérivé de `operations.service_id` (si `serviceId` aussi fourni et incohérent → 422) ; `operationId` absent → `serviceId` utilisé tel quel (F2/F3 inchangé). **REJET** du renommage physique `service_id`→`operation_id` (casserait ~20 DDL inline + reporting + oasdiff sans bénéfice).

**D2 — File = PAR SERVICE.** `queues.service_id` et `tickets.queue_id` restent NOT NULL. L'opération **ne crée PAS de file**. `resolveServiceQueue(operationId)` → résout `service_id = operations.service_id` → file service existante. Invariant `(queue_id, number, issued_day)` et numérotation `{service.code}-NNN` intacts.

**D3 — Migration ADDITIVE ; les services restent des services.** Les `services` actuels RESTENT des services (familles). On AJOUTE la table `operations`. Migration idempotente : pour chaque service existant, créer une **opération « défaut »** (hérite du SLA service) → un service sans opérations configurées se comporte comme avant. **PAS** de « service par défaut » fourre-tout (rejeté). Seed mis à jour + test up/down. **Lot dédié** : aligner les ~20 fixtures DDL `tickets` inline des tests (dette : les tests ne partagent pas le schéma Drizzle).

**D4 — SLA hérité ; AUCUNE « priorité » au niveau opération/service.** `operations.sla_minutes` NULLABLE. **Règle unique testable** : `SLA_résolu = operation.sla_minutes ?? service.sla_minutes`. Il n'existe PAS de colonne priorité sur services/operations — la priorité reste l'**enum PORTEUR** (VIP>PMR>SENIOR>PRIORITY>STANDARD) sur le ticket ; `selectNextPriority` **INCHANGÉ**. (Corrige la confusion du draft §4.)

**D5 — Conseiller = liste publique NOMINATIVE (pas d'attitré/CRM).** `users.is_relationship_manager` (bool) + `display_name` + `photo_url?`. `GET /public/agencies/{id}/relationship-managers` expose **UNIQUEMENT `{id, displayName, photoUrl?}`** (zéro PII : ni email, ni rôle, ni phone_hash), filtre `is_relationship_manager AND is_active AND deleted_at IS NULL`. **AUCUN lien client↔conseiller attitré** → respecte le hors-scope DÉFINITIF « CRM bancaire » (CLAUDE.md §5). Le client choisit librement dans la liste.

**D6 — File conseiller = PRIORITÉ ABSOLUE (arbitrage tranché).** `tickets.target_manager_id` NULLABLE (FK users). Nouvelle stratégie `selectNextForManager` (TicketSelector **injectable**, pas de refonte moteur). **Règle** : un agent conseiller sert **d'abord sa file perso** (`target_manager_id = lui`), **puis** la file de service (priorité absolue à la file conseiller) — testable. Ancrage : pas de nouvelle entité file ; la file conseiller = filtre `target_manager_id` (queue logique).

**D7 — Rendez-vous mobile (Phase C) = Boucle 1 DÉDIÉE ultérieure.** La Phase C (appointments, disponibilités, no-show, créneaux, TZ Abidjan, RDV→ticket) est **sous-spécifiée** et sort de cette vague. Cette vague livre **Phase A (Services→Opérations)** + **Phase B (Conseiller walk-in, liste publique)**. Conséquence : le **conseiller sur mobile = rendez-vous = Phase C** (à concevoir ensuite). → **À confirmer au PO** : Phase A+B maintenant (conseiller borne+web), Phase C (rendez-vous mobile) juste après en design dédié.

**D8 — RLS + stories manquantes ajoutées.** `operations` (et plus tard `appointments`) portent `bank_id` + `agency_id`, policy `tenant_isolation` (copie du pattern uniforme), GRANT sigfa_app. Stories AJOUTÉES au DAG : tenant-isolation des nouvelles tables (gate 6), Schemathesis des nouvelles routes (gate 5), migration up/down testée, impact **offline-sync** (`operation_id` optionnel dans `tickets-sync`, gate 7).

**D9 — DESIGN-gates borne.** Les 2 nouveaux écrans borne (**grille d'opérations**, **liste conseillers**) sont des écrans majeurs → **DESIGN-gate** (GO wireframe humain avant dispatch), cohérents avec la refonte v2 « Sérénité Premium » (réutilisent la grille + le jeu d'icônes SVG). MODEL-KIOSK-A = reprise du `ServicesScreen` v2 (met à jour snapshots).

**D10 — Affichage & codes.** `displayNumber` garde le préfixe `service.code` (file par service). `operations.code` regex `^[A-Z0-9]{2,6}$`, unique par service. `operations.icon_key` optionnel ; défaut = mapping par mot-clé (composant `ServiceIcon` existant).

## Conséquence sur le DAG
Phasage A/B/C conservé, Phase C sortie en Boucle 1 dédiée. Stories v2 (EARS à expanser après GO) : MODEL-CONTRACT-A → MODEL-DB-A → MODEL-API-A → {MODEL-KIOSK-A [design-gate], MODEL-WEB-A} pour la Phase A ; puis MODEL-CONTRACT-B → MODEL-DB-B → MODEL-API-B (arbitrage D6) → {MODEL-KIOSK-B [design-gate], MODEL-WEB-B} pour la Phase B. **En attente : GO PO** (dont confirmation du phasage D7 : conseiller mobile/rendez-vous = Phase C ultérieure).
