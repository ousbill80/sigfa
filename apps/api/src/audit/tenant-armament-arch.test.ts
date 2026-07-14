/**
 * Test d'ARCHITECTURE — armement tenant obligatoire (SEC-002, ferme SEC-F3-02).
 *
 * INTERDIT tout accès DB métier hors d'un chemin d'armement sanctionné :
 *   - `withArmedTenant` / `withArmedTenantFromPool` (contexte RLS `app.current_bank_id`) ;
 *   - `withPlatform` (connexion plateforme explicitement listée, SUPER_ADMIN).
 *
 * Le test énumère DYNAMIQUEMENT tous les fichiers de routes (`apps/api/src/routes`)
 * touchant la connexion `c.get("db")` et exige que CHACUN soit CLASSIFIÉ dans
 * l'inventaire ci-dessous. Un nouveau fichier de route qui accède à la DB sans être
 * classifié → CE TEST ÉCHOUE (pas de couverture manuelle qui se périme silencieusement).
 *
 * ÉTAT DU RECÂBLAGE (SEC-F3-02) — honnêteté d'inventaire :
 * Le primitif `withArmedTenant` est LIVRÉ et prouvé sur PG réelle (sigfa_app), et
 * compose avec SEC-001 (`withAudit` savepoint). La BASCULE de production consistant à
 * router CHAQUE requête HTTP tenant à travers une connexion armée (pool + middleware)
 * est un recâblage transverse volumineux (27 fichiers, 624 sites `db.query`, +
 * migration de tous les harnais de test vers le rôle `sigfa_app`). Il est SÉQUENCÉ via
 * `ARMED_CUTOVER_PENDING`. Ce test verrouille l'inventaire : il empêche toute NOUVELLE
 * route non-armée d'entrer sans décision explicite, et se resserre à mesure que les
 * fichiers migrent de `ARMED_CUTOVER_PENDING` vers `ARMED` (liste vide = dette fermée).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES_DIR = join(SRC_DIR, "routes");
/**
 * Répertoire des routeurs IA (IA-002/003/004). `GET /ai/forecast|anomalies|
 * feedback-insights` sont montés depuis `src/ai/*-route.ts` — ils accèdent à la DB
 * tenant au même titre que `src/routes/*`, donc l'inventaire d'armement DOIT les
 * couvrir (sinon une route DB tenant échapperait silencieusement au verrou).
 */
const AI_DIR = join(SRC_DIR, "ai");

/** Répertoires contenant des fichiers de routeurs montés (scannés pour l'inventaire). */
const ROUTE_DIRS: readonly string[] = [ROUTES_DIR, AI_DIR];

/**
 * Routes n'accédant PAS à une table tenant `bank_id` : connexion plateforme
 * (SUPER_ADMIN, `withPlatform`) ou aucune donnée tenant. Elles n'ont pas à armer
 * `app.current_bank_id`. Classées explicitement (défense-en-profondeur documentée).
 */
const PLATFORM_OR_PUBLIC: readonly string[] = [
  "health.ts", // GET /health — public, checks infra, aucune table tenant.
  "audit-logs.ts", // GET /audit-logs — AUDITOR/SUPER_ADMIN, connexion plateforme (cross-banques).
  "auth.ts", // /auth/* — résolution d'identité pré-tenant (login/refresh), avant contexte.
  // NET-001 — GET /admin/network-overview : SUPER_ADMIN, connexion plateforme
  // (withPlatform, cross-banques). LECTURE SEULE agrégée : n'arme JAMAIS
  // `app.current_bank_id` (pas de contexte tenant), mutations → 403 PLATFORM_READ_ONLY.
  "network-overview.ts",
  // SEC-002-CUTOVER-LOT9 — banks.ts : `banks` est la table RACINE du tenant. Par
  // DB-009 (0001_rls.sql), sigfa_app N'A AUCUN droit de mutation sur `banks`
  // (`REVOKE INSERT, UPDATE, DELETE`), seul le GRANT colonne-scopé des 3 seuils +
  // updated_at (0014/0015) est ouvert (réservé à thresholds.ts). Donc POST /banks
  // (INSERT) et PATCH /banks/:id (UPDATE name/is_active) sont STRUCTURELLEMENT
  // impossibles sous armement `sigfa_app` : ce sont des opérations de GESTION DE
  // BANQUE réservées à la connexion PLATEFORME (SUPER_ADMIN, RBAC platform). GET
  // /banks (liste cross-banques) exige aussi la plateforme (une liste armée serait
  // bornée à 1 banque par la RLS SELECT). Tout l'accès DB est routé via
  // `withPlatform` (frontière plateforme explicite). L'armer casserait la gestion
  // de banque — reclassé PLATFORM, jamais ARMED.
  "banks.ts",
];

/**
 * Routes tenant DONT LA BASCULE VERS `withArmedTenant` RESTE À FAIRE (dette
 * SEC-F3-02 séquencée). Aujourd'hui isolées par `WHERE bank_id` applicatif +
 * middleware RBAC ; à router à travers la connexion armée lors de la bascule
 * middleware/pool. RETIRER un fichier de cette liste quand il est effectivement armé.
 *
 * Cet inventaire EST le plan de recâblage : sa décroissance mesure la fermeture de
 * SEC-F3-02. Toute route tenant hors de cette liste ET hors `PLATFORM_OR_PUBLIC`
 * DOIT être armée (sinon le test échoue).
 */
const ARMED_CUTOVER_PENDING: readonly string[] = [
  // VIDE — dette SEC-F3-02 FERMÉE (F10-FEATURE-STORE + SEC-002-CUTOVER-LOT10).
  //
  // Le dernier fichier différé, `ai-forecast.ts`, est désormais ARMÉ : le câblage
  // feature-store (couture inter-piste) a livré le provider DB-backed
  // `dbFeatureStoreProvider`, qui lit `ai_features` (migration 0013) SOUS
  // `withArmedTenant` — la lecture tenant s'exécute sur la connexion `sigfa_app`
  // NOBYPASSRLS avec `app.current_bank_id` armé (RLS FORCE contraignante). Le fichier
  // porte l'armement (`withArmedTenant` + `c.get("db")`) → reclassé ARMED ci-dessous.
  //
  // Liste vide = toute route tenant accédant à la DB est ARMÉE ou explicitement
  // PLATFORM_OR_PUBLIC : plus aucune bascule en attente.
];

/**
 * Routes DÉJÀ armées (routent leur accès DB via `withArmedTenant`). Vide au moment
 * de la livraison du primitif ; se remplit à mesure de la bascule. Quand
 * `ARMED_CUTOVER_PENDING` est vide, la dette SEC-F3-02 est fermée.
 */
const ARMED: readonly string[] = [
  // ADM-001a : theming tenant — tout accès DB routé via withArmedTenant
  // (armement `app.current_bank_id` sur le bankId du chemin).
  "theme.ts",
  // ADM-003a — supervision borne (GET /agencies/{id}/kiosks/status). Lecture
  // tenant routée via `withArmedTenant` (RLS armée) : première route basculée.
  "kiosk-supervision.ts",
  // ADM-002a — onboarding agence < 2h (clone structurel + provisioning borne).
  // Tout accès DB tenant est routé via `withArmedTenant` (services clone/provision).
  "agency-onboarding.ts",
  // SEC-002-CUTOVER-LOT1 — routes de config tenant-scoped (faible risque). Tout
  // accès DB tenant routé via `withArmedTenant` (armement `app.current_bank_id`).
  // Tables `services` / `agencies` / `agency_exceptional_closures` / `counters` /
  // `counter_services` : policy `tenant_isolation` + GRANT CRUD `sigfa_app` vérifiés.
  "services.ts",
  "hours.ts",
  "counters.ts",
  // SEC-002-CUTOVER-LOT2 — routes de config/notifications tenant-scoped. Tout accès
  // DB tenant routé via `withArmedTenant` (armement `app.current_bank_id`).
  // - sms-templates.ts : `notification_templates` (policy `tenant_isolation` + CRUD, 0004).
  // - devices.ts : `notification_devices` (policy `tenant_isolation` + CRUD, 0004).
  // - kiosks-status.ts : `kiosks` (policy `tenant_isolation` + SELECT, 0001).
  "sms-templates.ts",
  "devices.ts",
  "kiosks-status.ts",
  // SEC-002-CUTOVER-LOT3 — bascule seuils/modèle métier tenant-scoped. Tout accès DB
  // tenant routé via `withArmedTenant` (armement `app.current_bank_id`).
  // - thresholds.ts : `banks` — SELECT (policy `tenant_isolation`) + UPDATE colonne-scopé
  //   des 3 seuils + `updated_at` (policy `tenant_update`, GRANT 0014+0015 COMPLÉTÉ).
  // - operations.ts : `operations` (policy `tenant_isolation` + CRUD, 0009) + `services`
  //   (lu pour le scope parent, policy `tenant_isolation` + SELECT, 0001).
  // - agencies.ts : `agencies` (policy `tenant_isolation` + CRUD, 0001) + `tickets`
  //   (lu pour la garde tickets ouverts, policy `tenant_isolation` + SELECT, 0001).
  // (reports.ts reste PENDING : chemin réseau cross-tenant → withPlatform, cf. note ci-dessus.)
  "thresholds.ts",
  "operations.ts",
  "agencies.ts",
  // SEC-002-CUTOVER-LOT4 — bascule du cycle ticket / file d'attente tenant-scopé.
  // Tout accès DB tenant routé via `withArmedTenant` (armement `app.current_bank_id`).
  // - tickets.ts : `tickets` / `queues` / `ticket_transfers` / `counters` / `operations`
  //   / `services` / `users` / `agency_users` / `agent_status_history` (policy
  //   `tenant_isolation` + GRANT CRUD) + `banks` (SELECT armé pour le timeout no-show).
  //   Le cœur `issueTicketFor` (partagé avec public/whatsapp NON armés) est rendu
  //   TRANSACTION-AWARE (SAVEPOINT sous armement, BEGIN/COMMIT sinon).
  // - tickets-sync.ts : batch offline — `tickets` / `queues` / `services` / `operations`
  //   / `users` / `agency_users` ; unité par item = SAVEPOINT dans la tx armée du batch.
  // - queues.ts : `queues` (policy `tenant_isolation` + GRANT CRUD) — audit composé SEC-001.
  "tickets.ts",
  "tickets-sync.ts",
  "queues.ts",
  // SEC-002-CUTOVER-LOT5 — bascule conseillers / import CSV / droit à l'oubli
  // tenant-scopé. Tout accès DB tenant routé via `withArmedTenant` (armement
  // `app.current_bank_id`).
  // - agents.ts : `users` / `agency_users` / `user_services` / `services` /
  //   `agencies` / `agent_status_history` (policy `tenant_isolation` + GRANT CRUD,
  //   0001). GET profil/stats lisent, PATCH + POST status mutent avec audit composé
  //   SEC-001 (savepoint) dans la transaction armée.
  // - agents-import.ts : batch offline — `users` / `agencies` / `agency_users` /
  //   `audit_log` ; unité par ligne = SAVEPOINT dans la transaction armée du batch.
  // - data-privacy.ts : droit à l'oubli — UPDATE `tickets` (anonymisation) + DELETE
  //   `notification_consents` (0004) + INSERT `audit_log` (0003) + lecture
  //   `retention_policies` (0006), tous en policy `tenant_isolation` + GRANT CRUD.
  //   L'effacement est borné à la banque armée (jamais un autre tenant).
  "agents.ts",
  "agents-import.ts",
  "data-privacy.ts",
  // SEC-002-CUTOVER-LOT6 — bascule des routes de LECTURE IA tenant-scopées. Tout accès
  // DB tenant routé via `withArmedTenant` (armement `app.current_bank_id`). Vivent sous
  // `src/ai/` (voir AI_DIR).
  // - anomaly-route.ts : `ai_anomalies` (policy `tenant_isolation` + GRANT CRUD
  //   `sigfa_app`, 0007). `loadAnomalies` (count + liste paginée `WHERE bank_id`) rejoué
  //   à travers la connexion armée. Lecture seule (zéro mutation).
  // - feedback-insights-route.ts : `tickets` (feedback_score/feedback_comment ; policy
  //   `tenant_isolation` + GRANT CRUD `sigfa_app`, 0001). La connexion armée est INJECTÉE
  //   au service partagé `feedback-insights-service` (INCHANGÉ) qui exécute son SELECT
  //   `WHERE bank_id` sur cette connexion. Lecture seule (zéro mutation).
  "anomaly-route.ts",
  "feedback-insights-route.ts",
  // SEC-002-CUTOVER-LOT7 — surfaces PUBLIQUES/SEMI-PUBLIQUES à token/session (le
  // tenant est RÉSOLU depuis un token/agencyId, jamais d'une auth staff). Tout accès
  // DB tenant est routé via `withArmedTenant` APRÈS résolution du tenant ; les seuls
  // accès hors armement sont les résolutions d'identité PRÉ-TENANT documentées.
  // - public-tickets.ts : POST /public/tickets ARME l'émission (`issueTicketFor`
  //   transaction-aware, SAVEPOINT sous armement) sur le bankId dérivé de l'agence ;
  //   POST …/feedback ARME UPDATE `tickets` + audit + agrégat NPS `daily_agency_stats`
  //   (policy `tenant_isolation` + GRANT CRUD, 0001/0005) ; GET …/operations et
  //   …/relationship-managers ARMENT leurs lectures (`operations`/`services`/`users`/
  //   `agency_users`) après résolution du bankId de l'agence. PRÉ-TENANT (hors
  //   armement, documenté) : le lookup `tracking_id` global (GET suivi + résolution
  //   feedback) et la résolution du bankId d'agence — résolution du token public,
  //   sans oracle d'énumération.
  // - tv-session.ts : POST /tv/session résout le bankId de l'agence (pré-tenant) puis
  //   CONFIRME l'agence DANS le tenant via `withArmedTenant` (RLS `agencies`) avant de
  //   signer le JWT DISPLAY. La confirmation armée est portée par la route (fabrique
  //   `armedRead` injectée au service).
  // - kiosk-session.ts : POST /kiosk/session résout le bankId de la borne (pré-tenant,
  //   lookup par id) puis ARME l'ouverture de session (`createKioskSession`) + l'audit ;
  //   DELETE …/:kioskId ARME la révocation `kiosks` + audit (tenant du JWT staff) ;
  //   POST /kiosks/:kioskId/heartbeat ARME l'UPDATE `kiosks` (tenant du JWT borne).
  //   Tables `kiosks`/`audit_log` : policy `tenant_isolation` + GRANT CRUD (0001/0003).
  //   NB : `kiosk-session.service.ts` (chantier borne parallèle) est INCHANGÉ ;
  //   l'armement est porté ENTIÈREMENT par le fichier de route.
  "public-tickets.ts",
  "tv-session.ts",
  "kiosk-session.ts",
  // SEC-002-CUTOVER-LOT8 — WEBHOOKS ENTRANTS : le tenant est RÉSOLU depuis le
  // PAYLOAD/la CONFIG (jamais d'une auth), APRÈS vérification d'authenticité du
  // webhook. Tout accès DB tenant post-résolution est routé via `withArmedTenant`.
  // - webhooks-notifications.ts : callbacks provider (statut delivery). La
  //   corrélation `provider_message_id → notification_log` résout le `bank_id`
  //   (PRÉ-TENANT, seule lecture hors armement — c'est la résolution du tenant), puis
  //   la mutation du journal (`applyDeliveryAck`) est ARMÉE (RLS `notification_log`
  //   `tenant_isolation` + GRANT SELECT/INSERT/UPDATE `sigfa_app`, 0004). Un accusé
  //   corrélé à A ne met à jour QUE le journal de A.
  // - webhooks-whatsapp-inbound.ts : messages WhatsApp entrants. La résolution de la
  //   config par `bankSlug` (`resolveWhatsAppConfig`) PRÉCÈDE légitimement l'armement
  //   (chicken-and-egg : le tenant n'est connu QU'APRÈS lecture de sa config), puis
  //   la signature banque est vérifiée ; TOUT le traitement tenant (idempotence
  //   `whatsapp_inbound_messages`, opt-in `notification_consents`, lecture `tickets`,
  //   émission `issueTicketFor` transaction-aware → SAVEPOINT) est routé DANS une
  //   transaction ARMÉE `withArmedTenant(bankId)`. Tables : policy `tenant_isolation`
  //   + GRANT CRUD `sigfa_app` (0012/0004/0001).
  "webhooks-notifications.ts",
  "webhooks-whatsapp-inbound.ts",
  // SEC-002-CUTOVER-LOT9 — SPLIT tenant/plateforme (FERMETURE de la dette hors
  // ai-forecast.ts). Tout accès DB TENANT routé via `withArmedTenant` (armement
  // `app.current_bank_id`).
  // - reports.ts : chemins TENANT (scope=agency, daily, benchmark, export) armés —
  //   `daily_agency_stats` / `agencies` / `export_jobs` (policy `tenant_isolation` +
  //   GRANT CRUD `sigfa_app`, 0005/0001). Le chemin RÉSEAU (scope=network,
  //   `buildNetworkResponse`) est SCINDÉ vers `withPlatform` (agrégat cross-tenant
  //   anonymisé, lit `daily_agency_stats` SANS filtre `bank_id` — l'armer le
  //   restreindrait à UNE banque). ARMED car son accès tenant passe par
  //   `withArmedTenant` ; le chemin plateforme cohabite via `withPlatform`.
  // - onboarding.ts : enrôlement d'agence/borne DANS un tenant EXISTANT (pas un
  //   bootstrap de nouveau tenant — aucune création de banque). clone-from mute
  //   `agencies`/`services`/`counters`/`counter_services` ; kiosk-access insère
  //   `kiosks` via `createKioskAccess` (connexion armée injectée). Gardes + mutations
  //   + audit composé SEC-001 dans UNE transaction armée (policy `tenant_isolation` +
  //   GRANT CRUD, 0001).
  "reports.ts",
  "onboarding.ts",
  // SEC-002-CUTOVER-LOT10 + F10-FEATURE-STORE — DERNIÈRE bascule, FERME SEC-F3-02.
  // - ai-forecast.ts : `GET /ai/forecast`. Le provider de features DB-backed
  //   (`dbFeatureStoreProvider`, activé par `FEATURE_STORE_PROVIDER=db`) lit
  //   `ai_features` (migration 0013 : policy `tenant_isolation` FORCE + GRANT
  //   SELECT/INSERT/UPDATE/DELETE `sigfa_app`) via `DbFeatureStore` SOUS
  //   `withArmedTenant(asArmable(c.get("db")), bankId, …)`. La lecture tenant est
  //   donc bornée à la banque armée par la RLS (défense-en-profondeur), pas seulement
  //   par le `WHERE bank_id`/`agency_id` applicatif. Le provider par défaut (feature-
  //   store désactivé) reste `emptyForecastDataProvider` → 422 gated (inchangé).
  "ai-forecast.ts",
];

/** Un fichier de routeur candidat + le répertoire qui le contient. */
interface RouteFile {
  readonly name: string;
  readonly dir: string;
}

/**
 * Un fichier `src/ai/*.ts` n'est un ROUTEUR (donc à inventorier) que s'il monte des
 * handlers Hono. Les modules purs (`forecast-model.ts`, `anomaly-detectors.ts`,
 * `feature-*.ts`…) accèdent parfois à la DB via une `QueryFn` injectée sans être des
 * routes montées : on ne retient que les fichiers `*-route.ts` (routeurs) + le
 * routeur `ai-forecast.ts` (vit sous `routes/`).
 */
function isRouterFile(name: string, dir: string): boolean {
  if (dir === AI_DIR) return name.endsWith("-route.ts");
  return true;
}

/**
 * Liste les fichiers de routeurs source (hors tests et harnais) sur tous les
 * répertoires de routes, avec leur répertoire d'origine.
 */
function listRouteSourceFiles(): RouteFile[] {
  return ROUTE_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith(".ts") &&
          !name.endsWith(".test.ts") &&
          !name.includes(".harness.") &&
          name !== "admin-test-harness.ts" &&
          isRouterFile(name, dir)
      )
      .map((name) => ({ name, dir }))
  );
}

/** Vrai si le fichier accède à la connexion DB de requête (`c.get("db")`). */
function touchesDb(file: RouteFile): boolean {
  const src = readFileSync(join(file.dir, file.name), "utf8");
  return src.includes('c.get("db")');
}

describe("SEC-002: architecture — armement tenant obligatoire (SEC-F3-02)", () => {
  it("SEC-002: le primitif d'armement withArmedTenant est exporté (source unique d'armement)", async () => {
    const armed = await import("src/lib/armed-tenant.js");
    expect(typeof armed.withArmedTenant).toBe("function");
    expect(typeof armed.withArmedTenantFromPool).toBe("function");
    expect(typeof armed.isCanonicalUuid).toBe("function");
  });

  it("SEC-002: TOUT fichier de route accédant à la DB est CLASSIFIÉ (armé / pending / plateforme) — nouveau fichier non classé → échec", () => {
    const classified = new Set<string>([
      ...ARMED,
      ...ARMED_CUTOVER_PENDING,
      ...PLATFORM_OR_PUBLIC,
    ]);
    const dbTouchingFiles = listRouteSourceFiles().filter(touchesDb);

    const unclassified = dbTouchingFiles
      .filter((f) => !classified.has(f.name))
      .map((f) => f.name);
    expect(
      unclassified,
      `Fichiers de route accédant à la DB sans classification d'armement : ` +
        `${unclassified.join(", ")}. Ajoutez-les à ARMED (si armés via withArmedTenant), ` +
        `à ARMED_CUTOVER_PENDING (bascule à venir), ou à PLATFORM_OR_PUBLIC (hors tenant).`
    ).toEqual([]);
  });

  it("SEC-002: l'inventaire ne référence AUCUN fichier fantôme (les 3 listes pointent des fichiers existants)", () => {
    const existing = new Set(listRouteSourceFiles().map((f) => f.name));
    const referenced = [...ARMED, ...ARMED_CUTOVER_PENDING, ...PLATFORM_OR_PUBLIC];
    const phantom = referenced.filter((f) => !existing.has(f));
    expect(
      phantom,
      `Fichiers référencés dans l'inventaire mais introuvables : ${phantom.join(", ")}`
    ).toEqual([]);
  });

  it("SEC-002: un fichier ARMÉ n'est jamais aussi PENDING (classification unique, pas d'ambiguïté)", () => {
    const pending = new Set(ARMED_CUTOVER_PENDING);
    const both = ARMED.filter((f) => pending.has(f));
    expect(both, `Fichiers à la fois ARMED et PENDING : ${both.join(", ")}`).toEqual(
      []
    );
  });

  it("SEC-002: un fichier ARMÉ route bien son accès DB via withArmedTenant (grep) — verrou anti-régression de la bascule", () => {
    const dirByName = new Map(
      listRouteSourceFiles().map((f) => [f.name, f.dir] as const)
    );
    for (const file of ARMED) {
      const dir = dirByName.get(file);
      expect(dir, `${file} est classé ARMED mais introuvable dans les répertoires de routes`).toBeDefined();
      const src = readFileSync(join(dir!, file), "utf8");
      expect(
        /withArmedTenant/.test(src),
        `${file} est classé ARMED mais n'appelle pas withArmedTenant`
      ).toBe(true);
    }
  });
});
