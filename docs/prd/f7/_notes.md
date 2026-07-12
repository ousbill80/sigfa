# F7 — REPORTING · Notes d'expansion (à valider avant dispatch)

Statut : DOCS uniquement (Boucle 1). Aucun code, aucun git.

## 1. Définitions métier à FAIRE VALIDER (formules exactes — REP-001)

Le glossaire v5 §5 donne les définitions **littéraires** ; l'expansion REP-001 les a rendues **calculables**. Points à trancher par le PO / métier avant implémentation :

1. **TMA — dénominateur** : moyenne sur les tickets **appelés** (`served_count`). Un ticket ABANDONED (jamais appelé) n'a pas de temps d'attente « servi » → exclu du TMA. À confirmer : le TMA doit-il inclure le temps d'attente des abandons (attente « subie ») ? (choix retenu : NON — TMA = attente des servis).
2. **TMT — base** : sur tickets **DONE** uniquement (`service_seconds = closed_at − serving_started_at`). Les NO_SHOW (appelés, absents) et TRANSFERRED comptent-ils ? (choix retenu : NON pour TMT ; à confirmer le traitement des TRANSFERRED — voir pt 6).
3. **Taux d'abandon — dénominateur** : `ABANDONED / (ABANDONED + served)`. Alternative possible : `ABANDONED / tickets_issued` (inclut tickets encore en file). Choix retenu : base terminale/appelée. À confirmer.
4. **Taux SLA — critère** : `wait_seconds ≤ SLA_service` (SLA basé sur l'**attente**, pas le traitement). Confirmer que le SLA porte bien sur le TMA et non sur le TTS. Borne **inclusive** (`≤`) retenue. Un abandon = SLA **non respecté** (retenu) — à confirmer.
5. **Occupation — dénominateur** : `agent_active_seconds / agent_available_seconds`. Définir précisément « available » : temps où l'agent est en statut disponible/en service (hors pause/déconnexion). Source = agrégation `agent_status_history` (DB-006/DB-001). Plafond 100% retenu. **Formule la plus incertaine — à valider en priorité.**
6. **TRANSFERRED** : un ticket transféré entre files/agents — comment attribuer wait/service ? (proposition : le segment avant transfert compte pour la file d'origine, le segment après pour la destination — à trancher ; impacte TMA/TMT/occupation).
7. **NPS** : mapping 5→promoter / 4→passive / ≤3→detractor (aligné API-010). Score ∈ [−100,+100]. Confirmé cohérent avec API-010.

## 2. Fenêtres temporelles & fuseau

- **Fuseau `Africa/Abidjan`** = UTC+00, **sans DST** → conversion stable, mais NE PAS coder « UTC = Abidjan » en dur (robustesse si un jour multi-pays UEMOA avec autre fuseau). Centraliser `toAbidjanDay()`.
- **Rattachement au jour** : par `issued_at` (jour d'émission), pas de clôture. À valider : un rapport « du jour » doit-il inclure les tickets **clos** ce jour mais **émis** la veille ? (choix retenu : rattachement émission — cohérent, mais à confirmer avec le métier car un directeur pense souvent « activité du jour = ce qui a été traité aujourd'hui »). **Ambiguïté à trancher.**
- **Fenêtre de rétro-calcul** : combien de temps un jour J reste-t-il recalculable après minuit (tickets multi-jours, corrections) ? Proposition : `upsertDailyStats(J)` rejouable J+1 matin avant le rapport ; définir un horizon (ex. 48h) au-delà duquel J est figé.

## 3. Risques

- **Perf agrégats à l'échelle** : critère de sortie k6 = 100 tickets/min/agence × 50 agences. `daily_agency_stats` matérialisé (DB-006) atténue, mais `upsertDailyStats` recalcule depuis `tickets` — coût à surveiller sur gros volumes/longues périodes. Prévoir index `(bank_id, day)` (DB-006 OK) et éventuellement recalcul incrémental delta plutôt que full-day. Read-replica noté hors scope DB-006.
- **Génération PDF** : techno non fixée (REP-002b/REP-003). Options : `@react-pdf/renderer` (JS pur, cohérent React Email) vs HTML→PDF (Playwright/Puppeteer — lourd, mais fidélité CSS/theming). Risque : polices FR/EN + logo tenant + « COMEX 1 page » sans débordement. **À arbitrer** (impacte REP-002b et REP-003).
- **Génération Excel** : lib (ex. `exceljs`) — cohérence des unités/en-têtes avec le JSON contractuel.
- **Coût des jobs planifiés** : hebdo/mensuel réseau = 50 agences × formats → pics de charge worker ; réutiliser back-pressure BullMQ (NOTIF-001).
- **Idempotence d'envoi** : dépend de la clé `(tenant,reportType,periodKey,recipient)` — bien définir `periodKey` (ex. `2026-W28`, `2026-07`, `2026-07-12`).

## 4. Ambiguïtés / questions ouvertes

- Q1 — Rattachement jour = émission vs clôture (voir §2). **À trancher.**
- Q2 — Formule occupation « available » précise (voir §1.5). **À trancher.**
- Q3 — Traitement des TRANSFERRED dans TMA/TMT/occupation (§1.6).
- Q4 — Le SLA porte-t-il sur l'attente (TMA) ou le service total (TTS) ? (§1.4).
- Q5 — Techno PDF (react-pdf vs headless browser) (§3).
- Q6 — Rapport journalier 18h : périmètre exact (00:00→18:00 seulement, ou 24h glissantes J-1 18h → J 18h ?). **À trancher.**
- Q7 — Destinataires QUALITY/COMEX : liste config par tenant — existe-t-il déjà un rôle/mécanisme d'abonnement, ou faut-il l'ajouter au contrat admin (CONTRACT-005) ?

## 5. Ajouts de contrat nécessaires (amont — API-First)

CONTRACT-006 couvre déjà : `/reports/kpis`, `/reports/daily/:agencyId`, `/reports/benchmark`, `/reports/export` (202+jobId), `/reports/export/:jobId`, `AnonymizedNetworkAggregate`. Compléments à signaler à agent-contract :

1. **Champ `partial: boolean`** sur les réponses KPI (jour courant non clos — REP-001) — non prévu explicitement dans CONTRACT-006 → **ajout additif**.
2. **Param `sortKpi`** sur `GET /reports/benchmark` (KPI de tri configurable) + **statut `n/a`** dans l'énum de statut couleur (agence sans donnée) → **ajouts additifs**.
3. **Métadonnées de période** normalisées dans les réponses (bornes début/fin en jour Abidjan + `periodKey`) — utile pour l'idempotence REP-002 et l'affichage → à contractualiser.
4. **Payload de rapport planifié** (REP-002 → REP-002b) : structure interne (non exposée publiquement) mais à typer dans `@sigfa/schemas` pour la couture api↔web — pas un endpoint, mais un schéma partagé.
5. **Rôles/abonnements COMEX/QUALITY** (Q7) : si absent, additif à CONTRACT-005 (admin) — hors périmètre F7 mais dépendance à signaler.
6. Vérifier que l'énum `export_jobs.status` du contrat (`PENDING/PROCESSING/READY/FAILED`) == DB-006 (aligné). OK, à re-confirmer au bundle.

## 6. Couture F6 (jobs)

- Rapports planifiés (REP-002) = **jobs BullMQ répétables** → dépendance **NOTIF-001** (infra queues, retry, dead-letter, idempotence) + **NOTIF-004** (email Resend/React Email). Ces dépendances sont déclarées dans REP-002. Le catalogue PRD_PRODUIT ne listait que `REP-001, NOTIF-004` pour REP-002 → **NOTIF-001 ajouté** comme dépendance d'infra (à valider par l'orchestrateur).
- Les jobs d'export (REP-003) réutilisent aussi l'infra BullMQ (NOTIF-001) — dépendance ajoutée.

## 7. Redécoupages appliqués (règle « 1 story = 1 couche = 1 agent »)

- **REP-002** (catalogue) → **REP-002** (planification/orchestration, agent-api) + **REP-002b** (gabarits documents React Email/PDF, agent-web).
- **REP-003** (catalogue) → **REP-003** (moteur export + calcul benchmarking, agent-api) + **REP-003b** (surface web export/benchmarking, agent-web).
- **REP-001** reste monolithique (couche calcul pure, agent-api) — pas de découpe.

## 8. Hors scope DÉFINITIF (rappel — ne jamais implémenter)

Core Banking / CRM bancaire / Mobile Money / USSD / Biométrie / connecteur BCEAO (CLAUDE.md §5). En particulier : **aucun lien reporting client↔conseiller nominatif** (CRM interdit), aucun export de PII, aucune donnée personnelle en scope network. Pas d'app mobile cliente. Langues **FR/EN uniquement**. IA/prédiction = F10 (REP-001 en est le prérequis, pas l'objet).
