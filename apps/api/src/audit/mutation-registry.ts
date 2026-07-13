/**
 * Registre VERSIONNÉ des mutations applicatives — SOURCE DE VÉRITÉ SEC-001a.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TOUTE mutation applicative (POST/PATCH/PUT/DELETE) DOIT figurer ici avec sa
 * disposition d'audit. AJOUTER UNE MUTATION = AJOUTER UNE LIGNE ICI.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le test de parité (`mutation-registry.test.ts`) confronte ce registre au
 * `ROUTE_RBAC_MAP` (routes réellement montées) : toute route mutante absente du
 * registre, ou toute entrée de registre sans route montée, fait ÉCHOUER le test.
 * Une mutation ajoutée sans branchement d'audit ET sans justification explicite
 * est donc IMPOSSIBLE à faire passer (le registre est la source de vérité).
 *
 * Modèle d'immuabilité (décision D, cf. SEC-001.md §9-10) : l'append-only est
 * garanti au niveau BASE (DB-004 : triggers UPDATE/DELETE→exception + REVOKE au
 * rôle applicatif). PAS de hash chain applicative en F9. Modèle de menace couvert
 * ici : un acteur applicatif (API compromise, agent malveillant) ne peut NI
 * effacer NI muter une trace — chaque mutation laisse une entrée append-only. La
 * menace « superuser/owner PostgreSQL » est couverte par la restriction d'accès
 * infra + PRA (SEC-003), HORS périmètre applicatif.
 *
 * @module
 */

/**
 * Disposition d'audit d'une mutation.
 * - `app`     : journalisée APPLICATIVEMENT via `insertAuditEntry`/`withAudit`
 *               dans la même transaction que la mutation (SEC-001a).
 * - `trigger` : journalisée par un trigger DB-004 (table de `AUDITED_TABLES`) —
 *               NE PAS doubler applicativement (éviterait la double entrée).
 * - `exempt`  : volontairement NON auditée, avec justification obligatoire
 *               (télémétrie haute fréquence, journal, ou opération non-mutante
 *               de l'état métier auditable).
 */
export type AuditDisposition = "app" | "trigger" | "exempt";

/** Descripteur d'une mutation applicative dans le registre. */
export interface MutationEntry {
  /** Méthode HTTP de la mutation. */
  readonly method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** Chemin (forme `ROUTE_RBAC_MAP`, segments `{param}`), sans préfixe /api/v1. */
  readonly path: string;
  /** Type d'entité affectée (aligné sur `entityType` de l'audit). */
  readonly entityType: string;
  /** Action journalisée attendue (stable, lisible), ou null si `exempt`. */
  readonly action: string | null;
  /** Disposition d'audit. */
  readonly disposition: AuditDisposition;
  /** Justification obligatoire pour `disposition: "exempt"`. */
  readonly exemptReason?: string;
}

/**
 * Registre exhaustif des mutations applicatives (non-DDL) de l'API SIGFA.
 *
 * Confronté au `ROUTE_RBAC_MAP` par le test de parité. L'ORDRE n'est pas
 * significatif ; le nommage `action` doit correspondre à ce que les routes
 * passent à `withAudit`/`recordAudit`.
 */
export const MUTATION_REGISTRY: readonly MutationEntry[] = [
  // ── AUTH (core.yaml) ──────────────────────────────────────────────────────
  // Login/refresh/logout : émission/rotation de jetons, PAS une mutation d'état
  // métier auditable (aucune entité applicative modifiée ; secrets exclus). Les
  // évènements de sécurité d'authentification relèvent de l'observabilité (F11),
  // pas du journal d'audit métier.
  {
    method: "POST", path: "/auth/login", entityType: "session",
    action: null, disposition: "exempt",
    exemptReason: "Authentification : émission de jeton, pas de mutation d'entité métier (observabilité F11).",
  },
  {
    method: "POST", path: "/auth/refresh", entityType: "session",
    action: null, disposition: "exempt",
    exemptReason: "Rotation de jeton : pas de mutation d'entité métier (observabilité F11).",
  },
  {
    method: "POST", path: "/auth/logout", entityType: "session",
    action: null, disposition: "exempt",
    exemptReason: "Révocation de refresh token : pas de mutation d'entité métier (observabilité F11).",
  },

  // ── BANKS (core.yaml) — table auditée par trigger DB-004 ──────────────────
  { method: "POST", path: "/banks", entityType: "bank", action: "POST /banks", disposition: "app" },
  { method: "PATCH", path: "/banks/{id}", entityType: "bank", action: "PATCH /banks/:id", disposition: "app" },

  // ── AGENCIES (core.yaml) ──────────────────────────────────────────────────
  { method: "POST", path: "/agencies", entityType: "agency", action: "POST /agencies", disposition: "app" },
  { method: "PATCH", path: "/agencies/{id}", entityType: "agency", action: "PATCH /agencies/:id", disposition: "app" },
  { method: "DELETE", path: "/agencies/{id}", entityType: "agency", action: "DELETE /agencies/:id", disposition: "app" },

  // ── SERVICES (core.yaml) ──────────────────────────────────────────────────
  { method: "POST", path: "/services", entityType: "service", action: "POST /services", disposition: "app" },
  { method: "PATCH", path: "/services/{id}", entityType: "service", action: "PATCH /services/:id", disposition: "app" },

  // ── OPERATIONS (core.yaml — MODEL-CONTRACT-A) ─────────────────────────────
  { method: "POST", path: "/services/{serviceId}/operations", entityType: "operation", action: "POST /services/:serviceId/operations", disposition: "app" },
  { method: "PATCH", path: "/operations/{id}", entityType: "operation", action: "PATCH /operations/:id", disposition: "app" },
  { method: "DELETE", path: "/operations/{id}", entityType: "operation", action: "DELETE /operations/:id", disposition: "app" },

  // ── COUNTERS (core.yaml) ──────────────────────────────────────────────────
  { method: "POST", path: "/counters", entityType: "counter", action: "POST /counters", disposition: "app" },
  { method: "PATCH", path: "/counters/{id}", entityType: "counter", action: "PATCH /counters/:id", disposition: "app" },
  { method: "POST", path: "/counters/{counterId}/call-next", entityType: "ticket", action: "POST /counters/:counterId/call-next", disposition: "app" },

  // ── QUEUES (core.yaml) ────────────────────────────────────────────────────
  { method: "PATCH", path: "/queues/{id}", entityType: "queue", action: "PATCH /queues/:id", disposition: "app" },

  // ── TICKETS (core.yaml) — HORS trigger DB-004 (décision `tickets`) ────────
  // Journalisées APPLICATIVEMENT (transitions fréquentes, hors trigger synchrone).
  { method: "POST", path: "/tickets", entityType: "ticket", action: "POST /tickets", disposition: "app" },
  { method: "POST", path: "/tickets/{id}/call", entityType: "ticket", action: "POST /tickets/:id/call", disposition: "app" },
  { method: "POST", path: "/tickets/{id}/serve", entityType: "ticket", action: "POST /tickets/:id/serve", disposition: "app" },
  { method: "POST", path: "/tickets/{id}/close", entityType: "ticket", action: "POST /tickets/:id/close", disposition: "app" },
  { method: "POST", path: "/tickets/{id}/no-show", entityType: "ticket", action: "POST /tickets/:id/no-show", disposition: "app" },
  { method: "POST", path: "/tickets/{id}/transfer", entityType: "ticket", action: "POST /tickets/:id/transfer", disposition: "app" },
  { method: "POST", path: "/tickets/{id}/abandon", entityType: "ticket", action: "POST /tickets/:id/abandon", disposition: "app" },
  { method: "POST", path: "/tickets/sync", entityType: "ticket", action: "POST /tickets/sync", disposition: "app" },

  // ── AGENTS (agents.yaml) ──────────────────────────────────────────────────
  { method: "PATCH", path: "/agents/{id}", entityType: "user", action: "PATCH /agents/:id", disposition: "app" },
  { method: "POST", path: "/agents/{id}/status", entityType: "user", action: "POST /agents/:id/status", disposition: "app" },
  { method: "POST", path: "/agents/import", entityType: "user", action: "POST /agents/import", disposition: "app" },

  // ── ADMIN — THEME / SMS TEMPLATES / THRESHOLDS / HOURS (admin.yaml) ────────
  { method: "PATCH", path: "/banks/{id}/theme", entityType: "theme", action: "PATCH /banks/:id/theme", disposition: "app" },
  { method: "POST", path: "/banks/{id}/theme/logo", entityType: "theme", action: "POST /banks/:id/theme/logo", disposition: "app" },
  { method: "PATCH", path: "/banks/{id}/sms-templates", entityType: "sms_template", action: "PATCH /banks/:id/sms-templates", disposition: "app" },
  { method: "PATCH", path: "/banks/{id}/thresholds", entityType: "threshold", action: "PATCH /banks/:id/thresholds", disposition: "app" },
  { method: "PATCH", path: "/agencies/{id}/hours", entityType: "agency_hours", action: "PATCH /agencies/:id/hours", disposition: "app" },

  // ── ADMIN — ONBOARDING (admin.yaml) ───────────────────────────────────────
  { method: "POST", path: "/agencies/{id}/kiosk-access", entityType: "kiosk", action: "POST /agencies/:id/kiosk-access", disposition: "app" },
  { method: "POST", path: "/agencies/{id}/clone-from/{templateId}", entityType: "agency", action: "POST /agencies/:id/clone-from/:templateId", disposition: "app" },

  // ── ADMIN — DATA PRIVACY (admin.yaml) ─────────────────────────────────────
  { method: "POST", path: "/data/purge-phone", entityType: "ticket", action: "POST /data/purge-phone", disposition: "app" },

  // ── KIOSK SESSION (public.yaml) — révocation de session borne (API-009/011) ─
  { method: "POST", path: "/kiosk/session", entityType: "kiosk", action: "POST /kiosk/session", disposition: "app" },
  { method: "DELETE", path: "/kiosk/session/{kioskId}", entityType: "kiosk", action: "DELETE /kiosk/session/:kioskId", disposition: "app" },
  // Heartbeat borne : télémétrie de présence (last_seen/printer/version), pas une
  // mutation d'état métier auditable.
  {
    method: "POST", path: "/kiosks/{kioskId}/heartbeat", entityType: "kiosk",
    action: null, disposition: "exempt",
    exemptReason: "Télémétrie de présence borne (last_seen/printer/version) — haute fréquence, non-métier.",
  },

  // ── PUBLIC TICKETS (public.yaml) — API-010 ────────────────────────────────
  { method: "POST", path: "/public/tickets", entityType: "ticket", action: "POST /public/tickets", disposition: "app" },
  { method: "POST", path: "/public/tickets/{trackingId}/feedback", entityType: "ticket", action: "POST /public/tickets/:trackingId/feedback", disposition: "app" },

  // ── TV SESSION (public.yaml) ──────────────────────────────────────────────
  {
    method: "POST", path: "/tv/session", entityType: "tv_session",
    action: null, disposition: "exempt",
    exemptReason: "Émission d'un token DISPLAY lecture seule (affichage TV) — aucune mutation d'entité métier.",
  },

  // ── NOTIFICATIONS (notifications.yaml) ────────────────────────────────────
  // notification_devices / consents : EXCLUS de l'audit par décision DB-004
  // (upsert haute fréquence + données pseudonymisées, contexte acteur non
  // résolvable). Cohérence directe avec AUDITED_TABLES.
  {
    method: "POST", path: "/notifications/devices", entityType: "notification_device",
    action: null, disposition: "exempt",
    exemptReason: "DB-004 : notification_devices EXCLUE (upsert haute fréquence, trigger trop bruité).",
  },
  {
    method: "DELETE", path: "/notifications/devices/{deviceId}", entityType: "notification_device",
    action: null, disposition: "exempt",
    exemptReason: "DB-004 : notification_devices EXCLUE (upsert haute fréquence, trigger trop bruité).",
  },
  {
    method: "POST", path: "/notifications/test", entityType: "notification",
    action: null, disposition: "exempt",
    exemptReason: "Envoi d'un SMS de test : action d'exploitation sans mutation d'entité de configuration.",
  },
  {
    method: "POST", path: "/notifications/opt-in", entityType: "notification_consent",
    action: null, disposition: "exempt",
    exemptReason: "DB-004 : notification_consents EXCLUE (données pseudonymisées, contexte acteur non résolvable).",
  },
  {
    method: "POST", path: "/notifications/opt-out", entityType: "notification_consent",
    action: null, disposition: "exempt",
    exemptReason: "DB-004 : notification_consents EXCLUE (données pseudonymisées, contexte acteur non résolvable).",
  },

  // ── AI (ai.yaml) — accusés de réception (F8) ──────────────────────────────
  {
    method: "POST", path: "/ai/staffing-recommendations/{id}/ack", entityType: "ai_recommendation",
    action: null, disposition: "exempt",
    exemptReason: "Accusé de lecture d'une recommandation IA : marqueur de consultation, hors périmètre audit métier (F8).",
  },
  {
    method: "POST", path: "/ai/anomalies/{id}/ack", entityType: "ai_anomaly",
    action: null, disposition: "exempt",
    exemptReason: "Accusé de lecture d'une anomalie IA : marqueur de consultation, hors périmètre audit métier (F8).",
  },

  // ── REPORTING (reporting.yaml) — export (F7) ──────────────────────────────
  {
    method: "POST", path: "/reports/export", entityType: "report_export",
    action: null, disposition: "exempt",
    exemptReason: "Déclenchement d'un export de reporting : opération de lecture asynchrone, hors périmètre audit métier (F7).",
  },

  // ── WEBHOOKS (public, signés fournisseur/banque) ──────────────────────────
  // Entrants signés HMAC : accusés/messages entrants tiers, pas des mutations
  // initiées par un acteur SIGFA. Traçabilité assurée par notification_log (F5).
  {
    method: "POST", path: "/webhooks/notifications/{provider}/delivery", entityType: "notification",
    action: null, disposition: "exempt",
    exemptReason: "Webhook fournisseur signé (accusé de livraison) : pas d'acteur SIGFA ; tracé par notification_log (F5).",
  },
  {
    method: "POST", path: "/webhooks/whatsapp/inbound/{bankSlug}", entityType: "notification",
    action: null, disposition: "exempt",
    exemptReason: "Webhook WhatsApp entrant signé par banque : pas d'acteur SIGFA ; tracé par notification_log (F5).",
  },
];

/**
 * Recherche l'entrée de registre correspondant à une méthode + un chemin.
 * Le chemin doit être la forme paramétrée `{param}` du `ROUTE_RBAC_MAP`.
 *
 * @param method - Méthode HTTP
 * @param path   - Chemin paramétré (ex. `/tickets/{id}/close`)
 * @returns L'entrée de registre, ou undefined si absente
 */
export function findMutationEntry(
  method: string,
  path: string
): MutationEntry | undefined {
  const upper = method.toUpperCase();
  return MUTATION_REGISTRY.find(
    (entry) => entry.method === upper && entry.path === path
  );
}
