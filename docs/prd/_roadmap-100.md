# Roadmap 100 % — SIGFA (suivi vivant Boucle 2 F6-F11)

**Mode** : exécution autonome totale (GO PO « exécute tout sans approbation »), **mock derrière interface**, branchement fournisseurs déféré (comptes SMS/WhatsApp/Email gérés par le PO ultérieurement). Séquencement de référence : `_arbitrage-f6-f11.md`.
**Légende** : ✅ fait · 🔄 en cours · ⏳ à lancer (autonome) · 🔒 gated (infra/données/design-gate/humain).

## Socle (fait)
✅ F0 infra · F1 contrats · F2 DB (27 tables RLS) · F3 API cœur · F4 kiosk/web/TV · RT temps réel · Modèle Services→Opérations→Conseillers · design v2 · TV-hardening · durcissement token · retrait app mobile (`archive/mobile-v0`).

## Racine Boucle 2
- ✅ **CONTRACT-013** additifs F6-F11 (non-breaking) — poussé `52cf00e`.

## F6 — Notifications & Jobs
- ✅ **NOTIF-001** infra BullMQ — intégré `cbcba4e`.
- 🔄 **NOTIF-002** SMS (mock adapter, opt-in, position, webhook).
- 🔄 **NOTIF-004** email (mock Resend, React Email, alertes/rapports).
- ⏳ **NOTIF-003** WhatsApp (après 002) — 🔒 limite templates HSM Meta au branchement réel.
- ⏳ **NOTIF-005-A** QR API (token signé HMAC).
- ⏳ **NOTIF-005-B** PWA ticket web → **story WEB** (rattachée F4/F5).

## F7 — Reporting
- 🔄 **REP-001** sla-engine (KPI D2) — intégration en cours (fix unité sec→min + réconcilie app.ts).
- ⏳ **REP-002** rapports planifiés · **REP-002b** gabarits PDF (@react-pdf A4).
- ⏳ **REP-003** exports+benchmark · **REP-003b** surface web.

## F8 — Admin & Theming
- ⏳ **ADM-001a** theme+contraste (api) · 🔒 **ADM-001b** console theming (DESIGN-gate).
- ⏳ **ADM-002a** clone+onboarding (api) · 🔒 **ADM-002b** Stepper (DESIGN-gate).
- ⏳ **ADM-003a** heartbeat+supervision (api) · 🔒 **ADM-003b** écran supervision (DESIGN-gate).

## F9 — Sécurité & Charge
- ⏳ **SEC-001a** audit exhaustif (api) · **SEC-001b** écran Auditor (web).
- ⏳ **SEC-002** tenant-isolation exhaustif (ferme dette RLS `withTenant` ; intègre le commit Schemathesis `harden/f3-debt`).
- ⏳ **SEC-003** PRA (mock S3) · 🔒 RTO/RPO réel gated infra.
- 🔒 **SEC-004** k6 charge — env de charge réel (PgBouncer×prepared-statements à tester tôt).
- ⏳ **SEC-005** Stryker — scope réduit « moteur de file » maintenant, extension sla-engine après REP-001.

## F10 — IA & Prédiction (code+synthétique mergeable ; critères pilote 🔒)
- ⏳ **IA-001** features · **IA-002** prévision · **IA-003** anomalies · **IA-004** NLP FR/EN · **IA-005** surfaces (mock).
- 🔒 cibles MAE/volume + critères pilote = données réelles (≥90 j).

## F11 — Supervision réseau
- ⏳ **NET-001-API** super admin lecture seule (après SEC-002) · 🔒 **NET-001-WEB** console (DESIGN-gate).
- ⏳ **NET-002** MAJ bornes canary · 🔒 signature artefact réelle.
- 🔒 **NET-003** monitoring Grafana/Sentry — infra réelle (dépend SEC-004).

## Bouts transverses
- ⏳ Fix unité REP-001 + réconcilie `app.ts`.
- ⏳ Skew **zod v4/v3** dans `@sigfa/schemas` (chantier `packages`) → débloque le DRY complet.
- ⏳ NOTIF-005-B PWA (story WEB).

## Blockers du VRAI 100 % (hors code — PO/infra)
🔒 Comptes fournisseurs SMS/WhatsApp/Email (**PO — demain**) · Infra R2/S3, PgBouncer, Grafana, Sentry, env k6 · **Pilote terrain** (→ F10 réel + critères sortie : TMA −30 %, NPS ≥75, uptime 99,9 %) · 4 DESIGN-gates (theming, onboarding, supervision, super admin) · décision GitHub Pro/public.

## Définition de « 100 % »
1. **100 % code (mock, autonome)** : F6-F9 + F11 + F10 (code/synthétique). Seul frein interne = DESIGN-gates web.
2. **100 % production-validé** : nécessite les blockers 🔒 + pilote.
