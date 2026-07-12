# Arbitrage de convergence — Boucle 1 F6-F11 (2026-07-12)

**Entrées** : 6 PRD expansées (`docs/prd/f6../f11/`, commit `d34b216`) + 3 critiques croisées (complétude / ambiguïté / faisabilité).
**Verdict** : Boucle 1 F6-F11 **CONVERGÉE**. Couverture catalogue **100 %** (NOTIF-001..005, REP-001..003, ADM-001..003, SEC-001..005, IA-001..005, NET-001..003), redécoupages une-couche-un-agent propres. Deux trous HIGH systémiques (contrat amont, formules REP-001) tranchés ci-dessous.

## Stratégie retenue (GO PO)
Implémentation **max autonome, TOUT en mock derrière interface** (adaptateurs SMS/WhatsApp/Email/S3/monitoring simulés, verts en CI ; branchement fournisseur réel NON urgent = « mettre en place tout le nécessaire »). **F10 : PRD + implémentation + tests synthétiques/mock mergeables MAINTENANT** ; seuls les critères « pilote » (≥90 j données réelles) restent gated. Propriété **exclusive** `apps/api`/`packages` (terminal parallèle terminé).

## Décisions d'arbitrage

- **D1 — CONTRACT-013 « batch additifs F6-F11 » = RACINE du DAG Boucle 2, EN PREMIER.** Une seule passe agent-contract, additifs **oasdiff NON-BREAKING** (job C4 vert), régénération mock Prism + client typé :
  - CONTRACT-007 : `NotificationType += POSITION_NEAR, POSITION_NEXT, MANAGER_ALERT, DAILY_REPORT, WEEKLY_REPORT, MONTHLY_REPORT` ; source consentement `INBOUND_WHATSAPP` ; lien signé pièce jointe email ; `/health` checks queues BullMQ.
  - CONTRACT-005 (admin) : `smsNearThreshold` (défaut 3) ; bloc config WhatsApp par banque (numéro, secret webhook, mapping menu→service) ; rôles/abonnements COMEX/QUALITY (reporting) ; routes theme (`GET/PATCH /banks/:id/theme`, `POST /theme/logo`, `GET /public/banks/:id/theme`) ; routes clone/provision/onboarding ; routes heartbeat/kiosks status + enum `KioskStatus`.
  - CONTRACT-006 : `partial:boolean` sur KPI ; `sortKpi` + statut `n/a` sur benchmark ; `periodKey` normalisé ; schéma network-overview **allow-list** explicite (agrégats, zéro PII) + code `PLATFORM_READ_ONLY` (403).
  - CONTRACT-003 : format `signedAgencyToken` du QR — **HMAC-SHA256, TTL 30 j, clé rotative versionnée** (aligné durcissement token TV/borne déjà clos).
  - CONTRACT-002 (Socket.io) : events `kiosk:silent`, `kiosk:recovered`, `kiosk:status`.
  - CONTRACT-008 : `AiMeta.dataWindow += featureSetVersion, availableDays` ; forecast `+= drivers[], lowConfidence` ; anomalies `+= evidence` ; feedback-insights `+= themes[] (enum), qualityScore décomposé, INSUFFICIENT_SAMPLE, language:unsupported`. Tous optionnels/additifs (mock F10 ne casse pas).

- **D2 — REP-001 = goulot du DAG, dispatché juste après CONTRACT-013.** Débloque SEC-005, IA-001..005, REP-002/003. **Défauts métier retenus** (le PO confirme/corrige — cf. « Décisions PO » ; le contrat + le moteur restent stables même si une formule bouge) :
  - Rattachement au jour = **`issued_at` (émission)**, fuseau Africa/Abidjan centralisé (`toAbidjanDay()`).
  - **SLA = attente** : `wait_seconds ≤ SLA_service` (pas le TTS).
  - **Abandon** = `ABANDONED / (ABANDONED + served)`.
  - **TRANSFERRED** : attente attribuée à la file d'origine, service post-transfert à la destination.
  - **Occupation** = base cohérente **par-agent** : `Σ agent_active_seconds / Σ agent_available_seconds` (source `agent_status_history` ; « available » = statuts en service hors pause/déconnexion).
  - Jour figé (`partial:false`) à **J+2 07 h Abidjan** ; jusque-là `partial:true`.

- **D3 — Défauts de seuils retenus** (autonomie ; PO peut override) : jitter backoff = full jitter borné `[0, min(cap, base·2^n)]` ; débit worker par canal = paramètre config défaut verrouillé ; `SENT` sans `DELIVERED` → `DELIVERY_UNKNOWN` à **TTL 24 h** ; suppression `POSITION_NEAR` si `POSITION_NEXT` attendu **< 60 s** ; un seul envoi par `(ticket,type)` à vie (jamais de renvoi sur re-franchissement) ; lien signé email/export TTL **24 h** ; enrollmentToken TTL configurable borné **[5, 120] min** ; skew heartbeat toléré **±5 min** ; mix k6 `1 émission:1 call:1 serve:1 close:0,3 feedback` ; exclusions mutants équivalents **≤ 5 %** ; IA `lowConfidence < 0,5` ; QUEUE_STUCK `N ≥ 3` tickets ; INSUFFICIENT_SAMPLE `< 30 feedbacks/agent` ; parité NLP `|F1_FR − F1_EN| ≤ 0,05` ; canary halt `> 10 % OFFLINE sur 15 min` ; NET-002 progression paliers manuelle jusqu'à 25 % puis auto si **30 min verts** ; NET-003 dédup alerte regroupement **10 min**.

- **D4 — Redécoupages ACCEPTÉS** (une-couche-un-agent) : ADM-001/002/003 → a(api)//b(web) ; REP-002→REP-002 + REP-002b, REP-003→REP-003 + REP-003b ; SEC-001→a(api)+b(web) ; NET-001→API+WEB ; NOTIF-005→A(api) **+ NOTIF-005-B sorti de F6** en story **WEB-0xx PWA** rattachée F4/F5 (ne bloque pas F6).

- **D5 — Pattern transverse « worker hors RLS »** (NOTIF-*, IA-*, REP-002/003) : le `bank_id` du job est la source de vérité ; le worker **ouvre `withTenant(bank_id)`** avant tout `db.*`. Validé UNE fois avec agent-database, réutilisé partout. Une faille = fuite cross-tenant silencieuse → test dédié systématique.

- **D6 — PDF reporting** : moteur **`@react-pdf/renderer`** (JS pur, testable en CI, pas de headless lourd) ; format **A4 portrait** ; snapshot « COMEX 1 page » + FR/EN. (REP-002b/REP-003.)

- **D7 — Contraste/theming** : l'utilitaire WCAG (contraste + assombrissement `--brand` par pas OKLCH L −0,02 jusqu'à ≥4,5:1) est **UNIQUE dans `@sigfa/ui`**, source de vérité serveur ET miroir preview front (anti-divergence). Palette candidate `brandContrast` = `{--ink, --ink-inverse}` uniquement.

- **D8 — `@sigfa/schemas` zod v4 vs api zod v3** : NE PAS forcer l'import des schémas générés (infère `unknown`). DRY autorisé sur `errorResponse` + `UUID_RE` regex uniquement, tant que le skew n'est pas résolu (chantier packages séparé).

- **D9 — SEC-002 ferme la dette RLS `withTenant` (SEC-F3-02)** ; ne pas la refaire ailleurs. Recâblage architectural potentiellement large → surveiller le budget 3-échecs, prérequis dur de NET-001. Le commit Schemathesis response-conformance déjà fait (`harden/f3-debt` `e4e3776`) sera intégré dans/avec SEC-002.

- **D10 — SEC-005** : dispatch en **scope réduit « moteur de file seul »** (API-004 DONE) dès maintenant ; extension au `sla-engine` dès REP-001 DONE. Ne pas bloquer la barre de sortie produit.

- **D11 — Mock ≠ clos pour SEC-004 (charge) et NET-003 (observabilité)** : artefacts (scénario k6, config PgBouncer, dashboards as-code, règles d'alerte) livrables maintenant, mais **validation des seuils GATED infra réelle** (env de charge dédié nightly ; métriques réelles). Ne pas les compter « 100 % clos » sur mock.

## Décisions PO — ✅ CONFIRMÉES par le PO le 2026-07-12 (verrouillées, ce ne sont plus des défauts)
1. **Formules KPI REP-001** (D2) : rattachement jour = émission ; SLA = attente ; TRANSFERRED origine/destination ; occupation par-agent. → impact direct sur ce que voient directeurs/COMEX.
2. **Périmètre rapport journalier 18 h** : `00:00→18:00` Abidjan (retenu) vs 24 h glissantes.
3. **IA (gated pilote)** : cible MAE, horizon J..J+7, seuil volume publication score, hébergement modèle intra-infra SIGFA (aucun tiers).
4. **SEC-001 immuabilité** : append-only DB retenu (pas de hash chain applicative) — à rouvrir si exigence conformité BCEAO/audit externe.
5. **NET-001** : banques exposées par `id + libellé` (PII client exclue) — OK par défaut.
6. **Backups** : R2 (déjà en place pour logos) vs S3.

## Séquencement Boucle 2 (propriété exclusive apps/api/packages)
0. **CONTRACT-013** (agent-contract, racine, additifs non-breaking) → régénère mock + client.
1. **REP-001** (agent-api, sla-engine pur, défauts D2) — goulot, tôt.
2. **F6** : NOTIF-001 (racine) → NOTIF-002 ‖ NOTIF-004 (workers distincts) → NOTIF-003 ; NOTIF-005-A indépendant.
3. **F7 aval** : REP-002 ‖ REP-003 → REP-002b ‖ REP-003b.
4. **F8** : paires a(api) ‖ b(web) sur mock ; 3 DESIGN-gates (theming, onboarding, supervision) soumis PO avant impl web.
5. **F9** : SEC-001a→b ; SEC-002 (lourd, prérequis NET-001) ; SEC-003 (game day CI mock S3) ; SEC-004 (nightly, gated infra) ; SEC-005 (scope réduit D10).
6. **F10** : IA-001 (racine) → IA-002/003/004 → IA-005 (mock) — tests synthétiques verts, critères pilote gated.
7. **F11** : SEC-002 → NET-001-API→WEB (DESIGN-gate) ; NET-002 ‖ NET-003 (gated infra).

## Risques techniques à surveiller (feasibility)
- **PgBouncer mode transaction × prepared statements** (SEC-004) : `SET LOCAL` de `withTenant` compatible, mais Drizzle/pg peut émettre des prepared statements serveur incompatibles → tester TÔT.
- **Templates WhatsApp HSM pré-approuvés Meta** (NOTIF-003) : le fallback texte libre banque→FR peut être REFUSÉ hors fenêtre 24 h — invisible sur mock, casse au branchement réel. Documenter comme limite runtime.
- **SEC-002 recâblage** potentiellement large. **Worker hors RLS** (D5). **zod skew** (D8).
- **Divergence mock/réel** intrinsèque SEC-004 + NET-003 (D11).
