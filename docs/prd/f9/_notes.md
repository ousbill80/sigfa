# F9 — Notes d'expansion : articulation avec la dette de durcissement, risques infra, questions ouvertes

**Date** : 2026-07-12 · **Rédacteur** : Boucle 1 (expansion) · **Portée** : docs uniquement.

---

## 1. Articulation avec la dette de durcissement EN COURS (ne pas dupliquer)

La dette consignée en clôture F3 / RT est le socle sur lequel F9 s'appuie. Cartographie explicite pour éviter la redondance :

| Dette consignée (source) | Story F9 qui la FORMALISE/FERME | Ce que F9 ajoute (≠ duplication) |
|---|---|---|
| **SEC-F3-02** — « recâbler l'accès DB via `withTenant`/RLS armée ; l'isolation repose aujourd'hui sur le `WHERE bank_id` applicatif testé » (f3/_dag.md, rt/_dag.md) | **SEC-002** | Ferme la dette : test d'architecture interdisant tout `db.*` métier hors `withTenant`/`withPlatform` ; bascule vers défense-en-profondeur (RLS FORCE + contexte), plus d'isolation applicative seule. |
| **COV-01** — « activer Schemathesis `response-schema-conformance` » (f3/_dag.md, rt/_dag.md) | **Aucune story F9 dédiée** — c'est de la dette F3/RT, PAS du périmètre F9. | F9 ne la reprend PAS (éviter le doublon). À traiter dans le durcissement F3/RT en cours (terminal parallèle). Signalé ici pour mémoire. |
| **STY DRY** — `@sigfa/schemas` non importé, types generated non consommés, `errorResponse` dupliqué, harnais de test dans `src/` (f3/_dag.md) | **Aucune story F9** — dette de style F3. | Hors périmètre sécurité/charge. Ne pas mélanger à F9. |
| **DB-002** — RLS `ENABLE`+`FORCE`+policy, rôle `sigfa_app` non-owner non-BYPASSRLS, `assertTenantIsolated()` (DONE) | **SEC-002** s'en sert comme base | SEC-002 étend la couverture aux tables F5–F8 + formalise la matrice table×route×attaque + gate CI ; ne réécrit PAS les policies. |
| **DB-004** — table `audit_log` immuable (triggers UPDATE/DELETE→exception, REVOKE), `insertAuditEntry()`, tickets HORS trigger, exclusion `*_hash/*_encrypted/*_cipher` (DONE) | **SEC-001** s'en sert comme base | SEC-001 ne touche NI la table NI l'immuabilité : il branche `insertAuditEntry()` sur les mutations non-DDL restantes (tickets surtout) + construit l'écran. |
| **CONTRACT-005 + API-011** — `GET /audit-logs` (AUDITOR/SUPER_ADMIN, `AuditEntry`, lecture seule) (DONE) | **SEC-001b** consomme la route | Aucune route audit à ajouter au contrat (voir §3) ; l'écran est pur consommateur API-First. |
| **RT-002** — protocole de latence normé p95<500ms, adapter Redis multi-instance (DONE) | **SEC-004** réutilise le protocole | SEC-004 rejoue le p95 SOUS CHARGE 50 agences ; ne redéfinit pas le protocole de mesure. |

**Chevauchements évités volontairement** :
- SEC-001 ne ré-implémente pas la hash chain / l'immuabilité (déjà en base). Décision consignée : pas de hash chain en F9 (cf. §3 QO-1).
- SEC-002 ne redéfinit pas les policies RLS ni `assertTenantIsolated()` — il les orchestre en matrice exhaustive + gate.
- SEC-004 ne re-teste pas les garanties temps réel unitaires de RT-002 — il les met à l'échelle.

---

## 2. Risques infra

**S3 / stockage objet (SEC-003)**
- Le projet utilise déjà **Cloudflare R2** pour les logos de theming (CONTRACT-005 : « URL signée R2 »). Risque de divergence si le PRA choisit AWS S3 pur → deux fournisseurs objets à opérer. **Recommandation** : réutiliser R2 (S3-compatible) pour homogénéité opérationnelle. Décision = QO-2.
- Coût/latence de restauration depuis stockage objet distant : le RTO 15 min inclut le download du backup — à valider selon taille de base et bande passante (risque si la base grossit). Le game day CI doit mesurer le RTO sur une taille réaliste, pas un seed minimal.
- Chiffrement des backups + gestion des clés (KMS ?) : un backup chiffré dont on perd la clé = perte totale. Runbook doit couvrir la custody des clés.

**PgBouncer (SEC-004)**
- **Mode transaction** requis pour le pooling efficace, MAIS incompatible avec certaines features PG session-level (prepared statements côté serveur, `SET` de session persistant). Or SIGFA utilise `SET LOCAL app.current_bank_id` via `withTenant` **dans une transaction** (DB-002) → compatible mode transaction (SET LOCAL est scoping transaction). **À VÉRIFIER explicitement** : que Drizzle/pg n'émette pas de prepared statements incompatibles avec PgBouncer transaction mode (risque `prepared statement "S_1" already exists`). Ce point est un risque réel de SEC-004 et doit être testé tôt.
- Dimensionnement pool : 50 agences × sockets + workers BullMQ + API → estimer les connexions concurrentes réelles avant de fixer `default_pool_size`.

**Adapter Redis multi-instance sous charge (SEC-004)**
- Le fan-out pub/sub Redis à 5000 tickets/min peut faire de Redis un point chaud. Surveiller la latence pub/sub sous charge (composante du p95<500ms).

---

## 3. Questions ouvertes

- **QO-1 (SEC-001) — Hash chain applicative ?** L'immuabilité est aujourd'hui purement DB (append-only forcé par trigger + REVOKE). Une hash chain (`prev_hash`/`entry_hash`) protégerait contre un attaquant `owner`/superuser PostgreSQL. **Décidé pour F9 : NON** (menace couverte par restriction d'accès infra + PRA). **À rouvrir** si une exigence de conformité externe (audit BCEAO, certification) l'impose. → décision PO requise avant toute conformité réglementaire.
- **QO-2 (SEC-003) — S3 vs R2 pour les backups ?** Recommandation : R2 (déjà en place pour logos, S3-compatible). Décision PO/ops.
- **QO-3 (SEC-005) — Séquencement vs REP-001.** SEC-005 dépend du `sla-engine` complet, dont les calculs d'agrégats arrivent avec REP-001 (F7, **non livré**). SEC-005 est marqué **BLOCKED**. Deux options : (a) attendre REP-001 DONE ; (b) livrer SEC-005 en scope réduit « moteur de file seul » maintenant, puis étendre au sla-engine après REP-001. **Décision d'orchestration requise.** F9 ne peut pas clôturer SEC-005 tant que REP-001 n'est pas fait.
- **QO-4 (SEC-002) — Périmètre tables.** Au moment de l'expansion, les tables F5–F8 (notifications DB-005, reporting DB-006, IA DB-007) peuvent ne pas toutes être créées selon l'avancement réel. La matrice s'appuie sur l'introspection `information_schema` → elle couvre automatiquement ce qui existe, MAIS le « 100 % » n'a de sens que sur le schéma déployé au moment du run. À rejouer à chaque ajout de table (gate CI permanente le garantit).
- **QO-5 (SEC-004) — Environnement de charge.** CI standard insuffisante pour 5000 tickets/min. Un environnement dédié (runner costaud / staging) est nécessaire. Où l'exécuter et à quelle fréquence (chaque PR = trop cher ; planifié nightly ?) → décision ops.

---

## 4. Découpages / signalements pour l'orchestrateur

- **SEC-001 est bi-couche** (agent-api + agent-web) : présentée avec deux lots `SEC-001a`/`SEC-001b` séparément dispatchables (critères déjà préfixés). Scinder en deux fichiers si l'orchestrateur préfère un fichier par agent — le trait de découpage est marqué dans SEC-001.md.
- **contract_additions_needed = 0** : `GET /audit-logs` + `AuditEntry` sont déjà contractualisés (CONTRACT-005) et implémentés (API-011 DONE). SEC-001 ne nécessite AUCUN ajout de contrat. Vérifié : aucune route audit manquante. (Seul point de vigilance signalé : `AuditEntry.diff` doit rester compatible avec le `diff {before, after}` produit par SEC-001a — le schéma actuel expose `diff` en objet libre, ce qui convient.)
- **SEC-005 BLOCKED** sur REP-001 (F7) — à ne pas dispatcher sans lever QO-3.
- **COV-01 / STY-DRY** (dette F3/RT) volontairement HORS F9 — à ne pas re-scoper ici.
