# Session 2026-07-12 — Panel adversarial Boucle 3 · LOT F3 (API cœur, API-001..011)

Fan-out parallèle de 3 relecteurs (lecture seule) sur `apps/api/src/**` après clôture de l'implémentation F3. Verdicts : **security → FIXES_REQUIRED** (1 BLOCKER, 6 MAJOR, 6 MINOR) · **coverage → FIXES_REQUIRED** (0 BLOCKER, 2 MAJOR, 4 MINOR) · **style → FIXES_REQUIRED** (0 BLOCKER, 5 MAJOR, 4 MINOR).

## Vérifications d'orchestrateur avant arbitrage
- **SEC-F3-01 CONFIRMÉ** : `ROLE_HIERARCHY` plaçait `AUDITOR:30 > AGENT:20` et `hasRequiredRole` retombait sur `userLevel >= requiredLevel` → escalade réelle (AUDITOR mutait tickets). BLOCKER légitime.
- **SEC-F3-02 PARTIELLEMENT ERRONÉ** : le relecteur affirmait que `withTenant` n'arme jamais la RLS — FAUX (`packages/database/src/tenant.ts:39` fait `SET LOCAL app.current_bank_id`). MAIS la préoccupation de fond tient : **les routes API n'utilisent pas `withTenant`** (elles font du `db.query` brut + `WHERE bank_id` manuel sur un client partagé) → la RLS ne fournit pas de défense en profondeur au niveau API. MAJOR architectural, volumineux → **consigné** (chantier dédié), non bloquant (isolation applicative présente + testée).
- **SEC-F3-04 CONFIRMÉ** : `VALID_ROLES` (csv-agents) incluait SUPER_ADMIN/BANK_ADMIN sans plafond.

## CORRIGÉ dans cette Boucle 3 — commit `4312c83` (fix agent-api, gate sérialisé 17/17, 447 tests, 0 co-signature)
| # | Sévérité | Finding | Correctif |
|---|---|---|---|
| SEC-F3-01 | **BLOCKER** | AUDITOR → routes AGENT (escalade) | AUDITOR rendu **orthogonal, lecture seule** (`hasRequiredRole(role, required, method)` : AUDITOR n'autorise que GET/HEAD/OPTIONS, 403 sur toute mutation) |
| SEC-F3-03 | MAJOR | Heartbeat écrit sur borne cross-tenant | `kioskId` du path DOIT == `kioskId` du JWT borne, sinon 404 |
| SEC-F3-04 | MAJOR | Import CSV crée SUPER_ADMIN/BANK_ADMIN | rejet des rôles > importateur + SUPER_ADMIN interdit en import (`ROLE_NOT_ALLOWED`) |
| SEC-F3-05 | MAJOR | Idempotence POST /tickets non atomique | verrou Redis SET NX PX in-flight (`acquireIdempotency`) → 1 seul ticket sous concurrence, 409 `IDEMPOTENCY_IN_PROGRESS` |
| SEC-F3-06 | MAJOR | Révocation session borne non appliquée sur WS | handshake `io.use` appelle `assertKioskSessionActive` → refus si révoquée |
| SEC-F3-07/11 | MAJOR | Rate-limit & audit bypass via X-Forwarded-For | `TRUST_PROXY` (env, défaut false) : XFF ignoré sauf proxy de confiance (`lib/client-ip.ts`) |
| SEC-F3-09 | MINOR | jwtVerify sans algo | `{ algorithms: ["HS256"] }` aux 2 appels |
| SEC-F3-12 | MINOR | MANAGER voit bornes hors agence | `kiosks/status` filtré par `tenant.agencyIds` pour rôles non bank-scoped |
| COV-02 | MAJOR (test) | Course call-next : « perdant obtient le suivant » non asserté, requêtes identiques, PG mort | assertions exactes (statuts ∈ {200,404}, count(CALLED)==count(200)==min(tickets,appels)), 1 connexion PG par requête concurrente |

## CONSIGNÉ — durcissement dédié (post-F3 / Boucle RT / hardening)
1. **SEC-F3-02 (MAJOR)** — recâbler l'accès DB des routes API à travers `withTenant` (RLS armée) + confirmer que la connexion applicative est `sigfa_app` (NOBYPASSRLS) ; aujourd'hui l'isolation repose sur le `WHERE bank_id` applicatif (présent, testé) + une regex middleware. Défense en profondeur RLS à activer.
2. **COV-01 (MAJOR)** — la cible Schemathesis F3 ne valide que `not_a_server_error` ; activer `response-schema-conformance` (`--checks all`) au moins sur les modules à enum contraint (public/reporting) — c'est ce qui avait laissé passer `SILENT` (déjà corrigé en `OFFLINE`).
3. **Style DRY (MAJOR)** : STY-001 `@sigfa/schemas` jamais importé (errorSchema/uuidSchema redéfinis) ; STY-002 types generated du contrat non consommés (couplage statique à LA LOI) ; STY-003 `errorResponse` dupliqué 5× ; STY-004 `admin-test-harness.ts` sous `src/routes/` (code de test dans l'arbre source) ; STY-005 `login()` ~110 lignes.
4. **MINORs** : SEC-08 rate-limit atomique (script Lua) ; SEC-10 strip HTML par regex ; COV-03 branche `redis=down` du health 503 ; COV-04 borne exacte T+24h00 ; COV-05 couverture de branches <85% sur 11 fichiers (lignes OK partout) ; COV-06 `toBeDefined()` faibles ; STY env vars (`LOG_LEVEL`, `LANGUAGE_SOFT_TIMEOUT_MINUTES`) absentes de `.env.example` ; STY-009 DTO public position/estimate = 0 (stub).

## Bien couvert (relevé par le panel — pas d'action)
Chiffrement téléphone AES-256-GCM+HMAC, presign R2 SigV4, verrou d'appel ciblé (SET NX PX + FOR UPDATE), idempotence sync (contrainte unique local_uuid), anti-énumération public (404 opaque, DTO sans uuid), rotation refresh (GETDEL + détection de vol), blocage login 5/15min, SQL paramétré partout, machine à états SLA exhaustive (42 combinaisons), verrou distribué BullMQ (course 2 instances), anti-flap agentId (test socket réel). Zéro `any`/`ts-ignore`/`console.log`, aucune route inventée hors contrat.

## État
F3 : 11/11 stories DONE + Boucle 3 (1 BLOCKER + 8 findings corrigés). Reste avant clôture définitive : traiter les items CONSIGNÉS (RLS, Schemathesis conformance, DRY) au durcissement, et la **frontière RT-001** (branchement réel socket/scheduler). Prochaine étape produit possible : RT-001 (bascule mock→réel) ou F4 restant (KIOSK-006..009, WEB-004..006).
