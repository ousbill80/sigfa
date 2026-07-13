/**
 * Mapping route→rôle GÉNÉRÉ depuis les bundles YAML (API-002).
 *
 * Source de vérité : packages/contracts/openapi/*.yaml (x-required-role).
 * Toute route non présente ici → échec au démarrage (500, jamais de défaut permissif).
 *
 * Rôles sentinelles (jamais en base PG) :
 *   - NONE        : route publique, pas d'authentification requise
 *   - AUTHENTICATED : tout JWT valide est accepté (ex: /auth/me, /kiosks/{kioskId}/heartbeat)
 *
 * Scopes :
 *   - platform : connexion migrateur (withPlatform), bankId non requis
 *   - bank     : connexion sigfa_app avec withTenant(bankId)
 *   - agency   : connexion sigfa_app avec withTenant(bankId) + vérification agencyId
 *   - public   : pas de connexion DB tenant
 *
 * @module
 */

/** Rôle RBAC requis pour une route (sentinelles incluses) */
export type RequiredRole =
  | "NONE"
  | "AUTHENTICATED"
  | "SUPER_ADMIN"
  | "BANK_ADMIN"
  | "AGENCY_DIRECTOR"
  | "MANAGER"
  | "AGENT"
  | "AUDITOR"
  | "DISPLAY"
  | "MISSING";

/** Scope de tenant pour une route */
export type TenantScope = "platform" | "bank" | "agency" | "public";

/** Entrée du mapping route → rôle + scope */
export interface RouteRbacEntry {
  method: string;
  path: string;
  requiredRole: RequiredRole;
  tenantScope: TenantScope;
}

/**
 * Hiérarchie des rôles SIGFA (du plus large au plus restreint).
 * Un rôle supérieur peut effectuer toutes les actions d'un rôle inférieur.
 *
 * ⚠️ AUDITOR est ABSENT de cette hiérarchie : c'est un rôle ORTHOGONAL (lecture
 * seule), il ne dérive JAMAIS un accès de la hiérarchie numérique (cf.
 * `hasRequiredRole`). Le placer ici (ex. AUDITOR > AGENT) rouvrirait l'escalade
 * de privilèges vers les routes mutantes AGENT (Boucle 3 F3 — BLOCKER).
 *
 * ⚠️ DISPLAY (token d'affichage TV public) est lui aussi ABSENT et ORTHOGONAL —
 * LEÇON SEC-F3-01. C'est un rôle d'AFFICHAGE SOCKET pur : il n'autorise AUCUNE
 * route HTTP (ni lecture ni mutation), seulement la réception des flux socket de
 * SA room. Le placer dans la hiérarchie (ou l'autoriser sur une lecture HTTP)
 * rouvrirait une escalade — il ne DOIT jamais satisfaire un `requiredRole` HTTP.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  SUPER_ADMIN: 100,
  BANK_ADMIN: 80,
  AGENCY_DIRECTOR: 60,
  MANAGER: 40,
  AGENT: 20,
  AUTHENTICATED: 1,
  NONE: 0,
};

/** Méthodes HTTP de LECTURE (idempotentes, sans effet de bord d'écriture). */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Vérifie si le rôle utilisateur satisfait le rôle requis pour une méthode donnée.
 *
 * Règles clés (Boucle 3 F3) :
 *   - SUPER_ADMIN passe toujours.
 *   - AUDITOR est ORTHOGONAL et LECTURE SEULE : il n'autorise QUE les routes en
 *     lecture (GET/HEAD/OPTIONS), qu'elles soient `requiredRole:"AGENT"`,
 *     `"MANAGER"`, `"AUDITOR"`, etc. Toute route mutante (POST/PATCH/PUT/DELETE)
 *     lui est REFUSÉE (403), même celles marquées `requiredRole:"AUDITOR"`.
 *   - Les routes `requiredRole:"AUDITOR"` ne sont accessibles qu'à AUDITOR (en
 *     lecture) et SUPER_ADMIN — jamais à AGENT/MANAGER via la hiérarchie.
 *   - Les autres rôles suivent la hiérarchie numérique inchangée.
 *
 * @param userRole     - Rôle du JWT
 * @param requiredRole - Rôle requis par la route
 * @param method       - Méthode HTTP de la requête (défaut « GET » : lecture)
 */
export function hasRequiredRole(
  userRole: string,
  requiredRole: RequiredRole,
  method = "GET"
): boolean {
  // Route publique : aucun rôle requis (le middleware ne l'atteint même pas).
  if (requiredRole === "NONE") return true;

  // DISPLAY (token d'affichage TV public) : rôle ORTHOGONAL d'AFFICHAGE SOCKET —
  // LEÇON SEC-F3-01. Sa SEULE surface est la réception socket de sa propre room.
  // Il ne satisfait AUCUNE route HTTP à rôle requis — ni mutation, ni lecture, ni
  // même une route `AUTHENTICATED` (sinon /auth/me, heartbeat, devices lui seraient
  // ouverts). Refus systématique AVANT toute autre règle (403). Un DISPLAY n'a
  // aucune raison d'appeler une route HTTP protégée.
  if (userRole === "DISPLAY") return false;

  if (requiredRole === "AUTHENTICATED") return userRole !== "NONE";

  // Le SUPER_ADMIN passe toujours (toutes méthodes, tous scopes).
  if (userRole === "SUPER_ADMIN") return true;

  const isRead = READ_METHODS.has(method.toUpperCase());

  // AUDITOR : rôle ORTHOGONAL, LECTURE SEULE. Jamais de mutation, jamais dérivé
  // de la hiérarchie AGENT/MANAGER. Autorisé uniquement sur les lectures.
  if (userRole === "AUDITOR") {
    return isRead;
  }

  // Routes `requiredRole:"AUDITOR"` : réservées à AUDITOR (traité ci-dessus) et
  // SUPER_ADMIN (traité ci-dessus). Aucun autre rôle ne les satisfait.
  if (requiredRole === "AUDITOR") {
    return false;
  }

  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 999;
  return userLevel >= requiredLevel;
}

/**
 * Mapping exhaustif route→rôle généré depuis les bundles YAML.
 * Chaque route du contrat OpenAPI doit avoir son entrée ici.
 */
export const ROUTE_RBAC_MAP: RouteRbacEntry[] = [
  // ── AUTH (core.yaml) ──────────────────────────────────────────────────────
  { method: "POST", path: "/auth/login",   requiredRole: "NONE",          tenantScope: "bank" },
  { method: "POST", path: "/auth/refresh", requiredRole: "NONE",          tenantScope: "bank" },
  { method: "POST", path: "/auth/logout",  requiredRole: "NONE",          tenantScope: "bank" },
  { method: "GET",  path: "/auth/me",      requiredRole: "AUTHENTICATED",  tenantScope: "bank" },

  // ── BANKS (core.yaml) ─────────────────────────────────────────────────────
  { method: "GET",   path: "/banks",      requiredRole: "SUPER_ADMIN", tenantScope: "platform" },
  { method: "POST",  path: "/banks",      requiredRole: "SUPER_ADMIN", tenantScope: "platform" },
  { method: "GET",   path: "/banks/{id}", requiredRole: "BANK_ADMIN",  tenantScope: "bank" },
  { method: "PATCH", path: "/banks/{id}", requiredRole: "BANK_ADMIN",  tenantScope: "bank" },

  // ── AGENCIES (core.yaml) ──────────────────────────────────────────────────
  { method: "GET",    path: "/agencies",        requiredRole: "BANK_ADMIN",       tenantScope: "bank" },
  { method: "POST",   path: "/agencies",        requiredRole: "BANK_ADMIN",       tenantScope: "bank" },
  { method: "GET",    path: "/agencies/{id}",   requiredRole: "AGENCY_DIRECTOR",  tenantScope: "agency" },
  { method: "PATCH",  path: "/agencies/{id}",   requiredRole: "AGENCY_DIRECTOR",  tenantScope: "agency" },
  { method: "DELETE", path: "/agencies/{id}",   requiredRole: "BANK_ADMIN",       tenantScope: "bank" },

  // ── SERVICES (core.yaml) ──────────────────────────────────────────────────
  { method: "GET",   path: "/services",     requiredRole: "MANAGER",          tenantScope: "agency" },
  { method: "POST",  path: "/services",     requiredRole: "AGENCY_DIRECTOR",  tenantScope: "agency" },
  { method: "PATCH", path: "/services/{id}", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },

  // ── OPERATIONS (core.yaml — MODEL-CONTRACT-A) ─────────────────────────────
  { method: "GET",    path: "/services/{serviceId}/operations", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "POST",   path: "/services/{serviceId}/operations", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "GET",    path: "/operations/{id}",                 requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "PATCH",  path: "/operations/{id}",                 requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "DELETE", path: "/operations/{id}",                 requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },

  // ── COUNTERS (core.yaml) ──────────────────────────────────────────────────
  { method: "GET",   path: "/counters",                       requiredRole: "MANAGER",         tenantScope: "agency" },
  { method: "POST",  path: "/counters",                       requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "PATCH", path: "/counters/{id}",                  requiredRole: "MANAGER",         tenantScope: "agency" },
  { method: "POST",  path: "/counters/{counterId}/call-next", requiredRole: "AGENT",           tenantScope: "agency" },

  // ── QUEUES (core.yaml) — x-security-note: agencyId validé ────────────────
  { method: "GET",   path: "/queues",      requiredRole: "MANAGER", tenantScope: "agency" },
  { method: "PATCH", path: "/queues/{id}", requiredRole: "MANAGER", tenantScope: "agency" },

  // ── TICKETS (core.yaml) ───────────────────────────────────────────────────
  { method: "POST", path: "/tickets",              requiredRole: "AGENT", tenantScope: "agency" },
  { method: "GET",  path: "/tickets/{id}",         requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/{id}/call",    requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/{id}/serve",   requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/{id}/close",   requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/{id}/no-show", requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/{id}/transfer", requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/{id}/abandon", requiredRole: "AGENT", tenantScope: "agency" },
  { method: "POST", path: "/tickets/sync",         requiredRole: "AGENT", tenantScope: "agency" },

  // ── AGENTS (agents.yaml) ──────────────────────────────────────────────────
  { method: "GET",   path: "/agents/{id}",           requiredRole: "MANAGER",         tenantScope: "agency" },
  { method: "PATCH", path: "/agents/{id}",           requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "POST",  path: "/agents/{id}/status",    requiredRole: "AGENT",           tenantScope: "agency" },
  { method: "GET",   path: "/agents/{id}/stats",     requiredRole: "AGENT",           tenantScope: "agency" },
  { method: "POST",  path: "/agents/import",         requiredRole: "AGENCY_DIRECTOR", tenantScope: "bank" },

  // ── ADMIN — THEME (admin.yaml) ────────────────────────────────────────────
  { method: "GET",   path: "/banks/{id}/theme",            requiredRole: "BANK_ADMIN", tenantScope: "bank" },
  { method: "PATCH", path: "/banks/{id}/theme",            requiredRole: "BANK_ADMIN", tenantScope: "bank" },
  { method: "GET",   path: "/banks/{id}/theme/logo-upload-url", requiredRole: "BANK_ADMIN", tenantScope: "bank" },

  // ── ADMIN — SMS TEMPLATES (admin.yaml) ────────────────────────────────────
  { method: "GET",   path: "/banks/{id}/sms-templates", requiredRole: "BANK_ADMIN", tenantScope: "bank" },
  { method: "PATCH", path: "/banks/{id}/sms-templates", requiredRole: "BANK_ADMIN", tenantScope: "bank" },

  // ── ADMIN — THRESHOLDS (admin.yaml) ───────────────────────────────────────
  { method: "GET",   path: "/banks/{id}/thresholds", requiredRole: "BANK_ADMIN", tenantScope: "bank" },
  { method: "PATCH", path: "/banks/{id}/thresholds", requiredRole: "BANK_ADMIN", tenantScope: "bank" },

  // ── ADMIN — AGENCY HOURS (admin.yaml) ─────────────────────────────────────
  { method: "GET",   path: "/agencies/{id}/hours", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "PATCH", path: "/agencies/{id}/hours", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },

  // ── ADMIN — KIOSK ACCESS (admin.yaml) ─────────────────────────────────────
  { method: "POST",   path: "/agencies/{id}/kiosk-access", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "POST",   path: "/agencies/{id}/clone-from/{templateId}", requiredRole: "BANK_ADMIN", tenantScope: "bank" },

  // ── ADMIN — AUDIT LOGS (admin.yaml) — platform ────────────────────────────
  { method: "GET", path: "/audit-logs", requiredRole: "AUDITOR", tenantScope: "platform" },

  // ── ADMIN — DATA PRIVACY (admin.yaml) ─────────────────────────────────────
  { method: "POST", path: "/data/purge-phone",    requiredRole: "BANK_ADMIN", tenantScope: "bank" },
  { method: "GET",  path: "/data/retention-policy", requiredRole: "BANK_ADMIN", tenantScope: "bank" },

  // ── NOTIFICATIONS (notifications.yaml) ───────────────────────────────────
  { method: "GET",    path: "/notifications/log",             requiredRole: "MANAGER",       tenantScope: "bank" },
  { method: "POST",   path: "/notifications/test",            requiredRole: "BANK_ADMIN",    tenantScope: "bank" },
  { method: "POST",   path: "/notifications/devices",         requiredRole: "AUTHENTICATED", tenantScope: "bank" },
  { method: "DELETE", path: "/notifications/devices/{deviceId}", requiredRole: "AUTHENTICATED", tenantScope: "bank" },
  { method: "POST",   path: "/notifications/opt-in",          requiredRole: "AGENT",         tenantScope: "agency" },
  { method: "POST",   path: "/notifications/opt-out",         requiredRole: "AGENT",         tenantScope: "agency" },
  { method: "GET",    path: "/notifications/consent",         requiredRole: "MANAGER",       tenantScope: "agency" },
  { method: "POST",   path: "/webhooks/notifications/{provider}/delivery", requiredRole: "NONE", tenantScope: "public" },

  // ── REPORTING (reporting.yaml) ────────────────────────────────────────────
  { method: "GET", path: "/health",                  requiredRole: "NONE",            tenantScope: "public" },
  { method: "GET", path: "/reports/kpis",            requiredRole: "AUDITOR",         tenantScope: "agency" },
  { method: "GET", path: "/reports/daily/{agencyId}", requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "GET", path: "/reports/benchmark",       requiredRole: "AUDITOR",         tenantScope: "bank" },
  { method: "GET", path: "/reports/export",          requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  // REP-003 : la story exige POST (202 + jobId) en plus du GET contractuel (mock).
  // AGENT (< AGENCY_DIRECTOR) interdit ; DIRECTOR+ OK. AUDITOR (lecture seule
  // orthogonale) déclenche l'export via la variante GET.
  { method: "POST", path: "/reports/export",         requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "GET", path: "/reports/export/{jobId}",  requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "GET", path: "/kiosks/status",           requiredRole: "MANAGER",         tenantScope: "agency" },
  { method: "GET", path: "/admin/network-overview",  requiredRole: "SUPER_ADMIN",     tenantScope: "platform" },

  // ── AI (ai.yaml) ──────────────────────────────────────────────────────────
  { method: "GET",  path: "/ai/forecast",                       requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "GET",  path: "/ai/staffing-recommendations",       requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "POST", path: "/ai/staffing-recommendations/{id}/ack", requiredRole: "MANAGER",     tenantScope: "agency" },
  { method: "GET",  path: "/ai/anomalies",                      requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "POST", path: "/ai/anomalies/{id}/ack",             requiredRole: "MANAGER",         tenantScope: "agency" },
  { method: "GET",  path: "/ai/feedback-insights",              requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },

  // ── PUBLIC (public.yaml) ──────────────────────────────────────────────────
  { method: "POST",   path: "/tv/session",                         requiredRole: "NONE",          tenantScope: "agency" },
  { method: "POST",   path: "/kiosk/session",                      requiredRole: "NONE",          tenantScope: "agency" },
  { method: "DELETE", path: "/kiosk/session/{kioskId}",            requiredRole: "AGENCY_DIRECTOR", tenantScope: "agency" },
  { method: "POST",   path: "/kiosks/{kioskId}/heartbeat",         requiredRole: "AUTHENTICATED", tenantScope: "agency" },
  { method: "GET",    path: "/agencies/{id}/qr",                   requiredRole: "AGENT",         tenantScope: "agency" },
  { method: "GET",    path: "/public/agencies/{agencyId}/operations", requiredRole: "NONE",       tenantScope: "public" },
  { method: "GET",    path: "/public/agencies/{agencyId}/relationship-managers", requiredRole: "NONE", tenantScope: "public" },
  { method: "POST",   path: "/public/tickets",                     requiredRole: "NONE",          tenantScope: "public" },
  { method: "GET",    path: "/public/tickets/{trackingId}",        requiredRole: "NONE",          tenantScope: "public" },
  { method: "POST",   path: "/public/tickets/{trackingId}/feedback", requiredRole: "NONE",        tenantScope: "public" },
  { method: "POST",   path: "/webhooks/whatsapp/inbound/{bankSlug}", requiredRole: "NONE",        tenantScope: "public" },
];

/**
 * Valide que le mapping ne contient aucune entrée avec `requiredRole: "MISSING"`.
 * Lance une erreur au démarrage si une entrée invalide est détectée.
 * Accepte un tableau optionnel pour les tests (injection d'entrées invalides).
 *
 * @param extraEntries - Entrées supplémentaires à valider (pour les tests)
 * @throws {Error} Si une entrée n'a pas de mapping valide
 */
export function validateRouteMapping(
  extraEntries?: RouteRbacEntry[]
): void {
  const entries = extraEntries ?? ROUTE_RBAC_MAP;
  for (const entry of entries) {
    if (entry.requiredRole === "MISSING") {
      throw new Error(
        `[SIGFA API] Route sans mapping RBAC détectée au démarrage : ` +
          `${entry.method} ${entry.path}. ` +
          `Ajoutez cette route dans rbac-route-map.ts.`
      );
    }
  }
}

/**
 * Recherche l'entrée RBAC pour un chemin et une méthode donnés.
 * Supporte les segments dynamiques ({id}, {bankSlug}, etc.).
 *
 * @param method - Méthode HTTP (GET, POST, etc.)
 * @param path   - Chemin de la requête (ex: /banks/uuid-123)
 * @returns L'entrée RBAC ou undefined si non trouvée
 */
export function findRouteEntry(
  method: string,
  path: string
): RouteRbacEntry | undefined {
  const normalizedMethod = method.toUpperCase();

  for (const entry of ROUTE_RBAC_MAP) {
    if (entry.method !== normalizedMethod) continue;
    if (pathMatches(entry.path, path)) return entry;
  }

  return undefined;
}

/**
 * Vérifie si un chemin de requête correspond à un patron de route (avec {param}).
 *
 * @param pattern - Patron de route (ex: /banks/{id}/theme)
 * @param path    - Chemin réel (ex: /banks/uuid-123/theme)
 */
function pathMatches(pattern: string, path: string): boolean {
  // Convertir les segments {param} en regex [^/]+
  const regexStr =
    "^" +
    pattern
      .replace(/\//g, "\\/")
      .replace(/\{[^}]+\}/g, "[^/]+") +
    "(?:\\/|\\?.*)?$";

  return new RegExp(regexStr).test(path);
}
