# Roadmap 100 % — SIGFA (suivi vivant Boucle 2 F6-F11)

**Mode** : exécution autonome totale (GO PO « exécute tout sans approbation »), **mock derrière interface**, branchement fournisseurs déféré (comptes SMS/WhatsApp/Email gérés par le PO ultérieurement). Séquencement de référence : `_arbitrage-f6-f11.md`.
**Légende** : ✅ fait · 🔄 en cours · ⏳ à lancer (autonome) · 🔒 gated (infra/données/design-gate/humain).

## Socle (fait)
✅ F0 infra · F1 contrats · F2 DB (27 tables RLS) · F3 API cœur · F4 kiosk/web/TV · RT temps réel · Modèle Services→Opérations→Conseillers · design v2 · TV-hardening · durcissement token · retrait app mobile (`archive/mobile-v0`).

## Racine Boucle 2
- ✅ **CONTRACT-013** additifs F6-F11 (non-breaking) — poussé `52cf00e`.

## F6 — Notifications & Jobs ✅ (API complet, poussé)
- ✅ **NOTIF-001** infra BullMQ · ✅ **NOTIF-002** SMS · ✅ **NOTIF-003** WhatsApp · ✅ **NOTIF-004** email · ✅ **NOTIF-005-A** QR API.
- ⏳ **NOTIF-005-B** PWA ticket web → **story WEB** (rattachée F4/F5).
- ⚠️ **Dépendance DB** : migration réelle requise pour `whatsapp_config`/`whatsapp_menu_mapping`, source `INBOUND_WHATSAPP`, types `POSITION_NEAR/NEXT`, colonnes consentement par canal (tests via DDL harnais ; PO travaille peut-être dessus dans `packages/database`).

## F7 — Reporting ✅ (API complet, poussé)
- ✅ **REP-001** sla-engine (KPI D2, unité minutes) · ✅ **REP-002** rapports planifiés (cron Abidjan) · ✅ **REP-003** exports async + benchmarking.
- ⏳ **REP-002b** gabarits PDF (@react-pdf A4) · **REP-003b** surface web export — **stories WEB**.
- ⚠️ Contrat : `/reports/export` exposé POST+GET (LOI ne déclare que GET) → ajout CONTRACT ultérieur.

## F8 — Admin & Theming
- ⏳ **ADM-001a** theme+contraste (api) · 🔒 **ADM-001b** console theming (DESIGN-gate).
- ⏳ **ADM-002a** clone+onboarding (api) · 🔒 **ADM-002b** Stepper (DESIGN-gate).
- ⏳ **ADM-003a** heartbeat+supervision (api) · 🔒 **ADM-003b** écran supervision (DESIGN-gate).

## F9 — Sécurité & Charge (partiel)
- ⏳ **SEC-001a** audit exhaustif (api) · **SEC-001b** écran Auditor (web) — 🔒 bloqué sur périmètre `31ee3ac`.
- ⏳ **SEC-002** tenant-isolation exhaustif (ferme dette RLS `withTenant` ; intègre `harden/f3-debt`) — 🔒 bloqué sur `31ee3ac`.
- ✅ **SEC-003** PRA backup/restore chiffré (mock S3, game day CI) — 🔒 RTO/RPO réel gated infra.
- 🔒 **SEC-004** k6 charge — env de charge réel (PgBouncer×prepared-statements à tester tôt).
- ✅ **SEC-005** Stryker mutation **100 %** sur queue-engine + sla-engine.

## F10 — IA & Prédiction (code+synthétique mergeable ; critères pilote 🔒)
- ⏳ **IA-001** features · **IA-002** prévision · **IA-003** anomalies · **IA-004** NLP FR/EN · **IA-005** surfaces (mock).
- 🔒 cibles MAE/volume + critères pilote = données réelles (≥90 j).

## F11 — Supervision réseau (ops fait)
- ⏳ **NET-001-API** super admin lecture seule (après SEC-002) · 🔒 **NET-001-WEB** console (DESIGN-gate).
- ✅ **NET-002** MAJ bornes canary/halt/rollback (mécanique) · 🔒 signature artefact réelle.
- ✅ **NET-003** monitoring règles+scrubbing PII (mock/simulé) · 🔒 infra réelle Grafana/Sentry.

## Infra / dette
- ✅ **Registre de routes** (`route-registry.ts`) — fin des conflits `app.ts` ; les nouvelles routes = 1 ligne.
- ⏳ Skew **zod v4/v3** (`@sigfa/schemas`) · ⏳ correctif teardown Redis REP-002 (mineur, CI verte) · ⏳ `harden/f3-debt` (Schemathesis) à merger avec SEC-002.

## Bouts transverses
- ⏳ Fix unité REP-001 + réconcilie `app.ts`.
- ⏳ Skew **zod v4/v3** dans `@sigfa/schemas` (chantier `packages`) → débloque le DRY complet.
- ⏳ NOTIF-005-B PWA (story WEB).

## Blockers du VRAI 100 % (hors code — PO/infra)
🔒 Comptes fournisseurs SMS/WhatsApp/Email (**PO — demain**) · Infra R2/S3, PgBouncer, Grafana, Sentry, env k6 · **Pilote terrain** (→ F10 réel + critères sortie : TMA −30 %, NPS ≥75, uptime 99,9 %) · 4 DESIGN-gates (theming, onboarding, supervision, super admin) · décision GitHub Pro/public.

## Définition de « 100 % »
1. **100 % code (mock, autonome)** : F6-F9 + F11 + F10 (code/synthétique). Seul frein interne = DESIGN-gates web.
2. **100 % production-validé** : nécessite les blockers 🔒 + pilote.
