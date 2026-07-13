/**
 * CONTRACT-013 — Batch additifs F6-F11 (racine du DAG Boucle 2)
 *
 * Tests structurels de contrat pour les additifs NON-BREAKING décidés en arbitrage
 * (docs/prd/_arbitrage-f6-f11.md, décision D1). TOUS les ajouts sont optionnels/additifs :
 * zéro retrait, zéro nouveau champ requis sur l'existant.
 *
 * Domaines couverts :
 *  1. Notifications (CONTRACT-007) : NotificationType +6, source INBOUND_WHATSAPP,
 *     lien signé pièce jointe email, /health checks queues BullMQ.
 *  2. Admin (CONTRACT-005) : smsNearThreshold, config WhatsApp banque, rôles COMEX/QUALITY,
 *     routes theme publiques + codes, clone/provision/onboarding, heartbeat/kiosks status + KioskStatus.
 *  3. Reporting (CONTRACT-006) : partial, sortKpi + statut n/a, périodes normalisées.
 *  4. Supervision réseau (CONTRACT-006) : network-overview allow-list + PLATFORM_READ_ONLY.
 *  5. QR (CONTRACT-003) : signedAgencyToken HMAC-SHA256 TTL 30 j clé rotative versionnée.
 *  6. Socket.io (CONTRACT-002) : kiosk:silent, kiosk:recovered, kiosk:status.
 *  7. IA (CONTRACT-008) : dataWindow +featureSetVersion/availableDays, forecast +drivers/lowConfidence,
 *     anomalies +evidence, feedback-insights +themes/qualityScore décomposé/INSUFFICIENT_SAMPLE/language.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  kioskSilentEvent,
  kioskRecoveredEvent,
  kioskStatusEvent,
  ALL_EVENTS,
} from "./index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPENAPI_DIR = resolve(__dirname, "../openapi");

function loadYaml(name: string): Record<string, unknown> {
  const raw = readFileSync(resolve(OPENAPI_DIR, name), "utf-8");
  return parse(raw) as Record<string, unknown>;
}

type AnyObj = Record<string, unknown>;

function schemasOf(doc: AnyObj): Record<string, AnyObj> {
  return ((doc.components as AnyObj | undefined)?.schemas ?? {}) as Record<string, AnyObj>;
}
function pathsOf(doc: AnyObj): Record<string, Record<string, AnyObj>> {
  return (doc.paths ?? {}) as Record<string, Record<string, AnyObj>>;
}
function props(schema: AnyObj | undefined): Record<string, AnyObj> {
  return (schema?.properties ?? {}) as Record<string, AnyObj>;
}
function enumOf(schema: AnyObj | undefined): string[] {
  return (schema?.enum ?? []) as string[];
}
function required(schema: AnyObj | undefined): string[] {
  return (schema?.required ?? []) as string[];
}

const core = loadYaml("core.yaml");
const notifications = loadYaml("notifications.yaml");
const admin = loadYaml("admin.yaml");
const reporting = loadYaml("reporting.yaml");
const ai = loadYaml("ai.yaml");
const publicDoc = loadYaml("public.yaml");

// ─── 1. NOTIFICATIONS (CONTRACT-007) ─────────────────────────────────────────

describe("CONTRACT-013 F6-F11 — Notifications (CONTRACT-007)", () => {
  it("NotificationType gagne POSITION_NEAR/POSITION_NEXT/MANAGER_ALERT/DAILY/WEEKLY/MONTHLY_REPORT sans retrait", () => {
    const nt = schemasOf(core)["NotificationType"];
    const values = enumOf(nt);
    for (const added of [
      "POSITION_NEAR",
      "POSITION_NEXT",
      "MANAGER_ALERT",
      "DAILY_REPORT",
      "WEEKLY_REPORT",
      "MONTHLY_REPORT",
    ]) {
      expect(values, `NotificationType doit contenir ${added}`).toContain(added);
    }
    // Non-régression : l'existant reste
    for (const existing of ["TICKET_CONFIRMATION", "POSITION_UPDATE", "YOUR_TURN", "DAILY_REPORT"]) {
      expect(values, `${existing} doit rester`).toContain(existing);
    }
  });

  it("ConsentRequest expose une source de consentement optionnelle incluant INBOUND_WHATSAPP", () => {
    const s = schemasOf(notifications);
    const consentSource = s["ConsentSource"];
    expect(consentSource, "ConsentSource enum doit exister").toBeDefined();
    expect(enumOf(consentSource)).toContain("INBOUND_WHATSAPP");
    // source ajoutée au ConsentRequest, optionnelle (non-breaking)
    const cr = s["ConsentRequest"];
    expect(props(cr)["source"], "ConsentRequest.source doit exister").toBeDefined();
    expect(required(cr), "source ne doit PAS être requis (non-breaking)").not.toContain("source");
  });

  it("Le journal de notification expose un lien signé de pièce jointe email (optionnel)", () => {
    const entry = schemasOf(notifications)["NotificationLogEntry"];
    const attach = props(entry)["attachmentSignedUrl"];
    expect(attach, "attachmentSignedUrl doit exister sur NotificationLogEntry").toBeDefined();
    expect(required(entry), "attachmentSignedUrl reste optionnel").not.toContain("attachmentSignedUrl");
  });

  it("/health expose des checks de santé des queues BullMQ (optionnel, non-breaking)", () => {
    const hr = schemasOf(reporting)["HealthResponse"];
    const checks = props(hr)["checks"];
    expect(checks, "HealthResponse.checks doit exister").toBeDefined();
    expect(required(hr), "checks reste optionnel (non-breaking)").not.toContain("checks");
    // mention explicite des queues BullMQ
    expect(JSON.stringify(hr).toLowerCase()).toMatch(/queue|bullmq/);
  });
});

// ─── 2. ADMIN (CONTRACT-005) ─────────────────────────────────────────────────

describe("CONTRACT-013 F6-F11 — Admin (CONTRACT-005)", () => {
  it("smsNearThreshold (défaut 3) ajouté aux seuils banque (optionnel)", () => {
    const bt = schemasOf(admin)["BankThresholds"];
    const near = props(bt)["smsNearThreshold"];
    expect(near, "smsNearThreshold doit exister").toBeDefined();
    expect(near?.default, "défaut 3").toBe(3);
    expect(required(bt), "smsNearThreshold reste optionnel (non-breaking)").not.toContain(
      "smsNearThreshold",
    );
    // aussi accepté en mise à jour partielle
    expect(props(schemasOf(admin)["UpdateBankThresholdsRequest"])["smsNearThreshold"]).toBeDefined();
  });

  it("Config WhatsApp Business par banque (numéro, secret webhook, mapping menu→service)", () => {
    const cfg = schemasOf(admin)["WhatsAppConfig"];
    expect(cfg, "WhatsAppConfig doit exister").toBeDefined();
    const p = props(cfg);
    expect(p["businessNumber"], "businessNumber").toBeDefined();
    expect(p["webhookSecret"], "webhookSecret").toBeDefined();
    expect(p["menuMapping"], "menuMapping (menu→service)").toBeDefined();
  });

  it("Rôles COMEX et QUALITY ajoutés à l'enum Role (reporting) sans retrait", () => {
    const role = schemasOf(core)["Role"];
    const values = enumOf(role);
    expect(values).toContain("COMEX");
    expect(values).toContain("QUALITY");
    for (const existing of ["SUPER_ADMIN", "BANK_ADMIN", "AGENCY_DIRECTOR", "AUDITOR", "NONE"]) {
      expect(values, `${existing} doit rester`).toContain(existing);
    }
  });

  it("Route publique de projection du thème : GET /public/banks/{id}/theme", () => {
    const op = pathsOf(admin)["/public/banks/{id}/theme"]?.["get"];
    expect(op, "GET /public/banks/{id}/theme doit exister").toBeDefined();
    expect(op?.["x-required-role"], "route publique = NONE").toBe("NONE");
  });

  it("POST /banks/{id}/theme/logo (upload multipart) documenté", () => {
    const op = pathsOf(admin)["/banks/{id}/theme/logo"]?.["post"];
    expect(op, "POST /banks/{id}/theme/logo doit exister").toBeDefined();
  });

  it("Codes theme INVALID_BRAND / UNKNOWN_FIELD / INVALID_LOGO présents dans admin.yaml", () => {
    const raw = readFileSync(resolve(OPENAPI_DIR, "admin.yaml"), "utf-8");
    for (const code of ["INVALID_BRAND", "UNKNOWN_FIELD", "INVALID_LOGO"]) {
      expect(raw, `admin.yaml doit mentionner ${code}`).toContain(code);
    }
  });

  it("Routes clone/provision/onboarding présentes + codes CLONE_SOURCE_REQUIRED / KIOSK_ENROLLMENT_INVALID", () => {
    const paths = pathsOf(admin);
    expect(paths["/banks/{id}/agencies:clone"]?.["post"], "clone doit exister").toBeDefined();
    expect(
      paths["/agencies/{id}/kiosks:provision"]?.["post"],
      "provision borne doit exister",
    ).toBeDefined();
    expect(
      paths["/agencies/{id}/onboarding/{onboardingId}"]?.["get"],
      "suivi onboarding doit exister",
    ).toBeDefined();
    const raw = readFileSync(resolve(OPENAPI_DIR, "admin.yaml"), "utf-8");
    expect(raw).toContain("CLONE_SOURCE_REQUIRED");
    expect(raw).toContain("KIOSK_ENROLLMENT_INVALID");
  });

  it("Heartbeat + status bornes : POST /kiosks/{id}/heartbeat, GET .../kiosks/status, enum KioskStatus", () => {
    const paths = pathsOf(admin);
    expect(paths["/kiosks/{id}/heartbeat"]?.["post"], "heartbeat doit exister").toBeDefined();
    expect(
      paths["/agencies/{id}/kiosks/status"]?.["get"],
      "status bornes par agence doit exister",
    ).toBeDefined();
    const ks = schemasOf(admin)["KioskStatus"];
    expect(ks, "KioskStatus enum doit exister").toBeDefined();
    for (const v of ["ONLINE", "DEGRADED", "SILENT", "NEVER_SEEN"]) {
      expect(enumOf(ks), `KioskStatus doit contenir ${v}`).toContain(v);
    }
  });

  it("Config supervision borne : heartbeatIntervalSec / silentThresholdSec (optionnels)", () => {
    const cfg = schemasOf(admin)["KioskSupervisionConfig"];
    expect(cfg, "KioskSupervisionConfig doit exister").toBeDefined();
    expect(props(cfg)["heartbeatIntervalSec"]).toBeDefined();
    expect(props(cfg)["silentThresholdSec"]).toBeDefined();
  });
});

// ─── 3. REPORTING (CONTRACT-006) ─────────────────────────────────────────────

describe("CONTRACT-013 F6-F11 — Reporting (CONTRACT-006)", () => {
  it("partial:boolean ajouté aux réponses KPI (optionnel, non-breaking)", () => {
    const kpi = schemasOf(reporting)["KpiResponse"];
    expect(props(kpi)["partial"], "KpiResponse.partial doit exister").toBeDefined();
    expect(props(kpi)["partial"]?.type).toBe("boolean");
    expect(required(kpi), "partial reste optionnel").not.toContain("partial");
    // idem réseau
    expect(props(schemasOf(reporting)["NetworkKpiResponse"])["partial"]).toBeDefined();
  });

  it("sortKpi param sur /reports/benchmark + statut n/a sur BenchmarkStatus", () => {
    const op = pathsOf(reporting)["/reports/benchmark"]?.["get"];
    const params = (op?.parameters ?? []) as AnyObj[];
    const hasSort = params.some((p) => p["name"] === "sortKpi");
    expect(hasSort, "param sortKpi doit exister sur /reports/benchmark").toBe(true);
    expect(enumOf(schemasOf(reporting)["BenchmarkStatus"]), "statut n/a").toContain("n/a");
  });

  it("Métadonnées période normalisées : periodKey + bornes jour Abidjan (optionnel)", () => {
    const pm = schemasOf(reporting)["PeriodMeta"];
    expect(pm, "PeriodMeta doit exister").toBeDefined();
    const p = props(pm);
    expect(p["periodKey"], "periodKey").toBeDefined();
    expect(p["start"], "borne de début").toBeDefined();
    expect(p["end"], "borne de fin").toBeDefined();
    // exposé optionnellement sur KpiResponse
    expect(props(schemasOf(reporting)["KpiResponse"])["periodMeta"]).toBeDefined();
    // mention du fuseau Abidjan
    expect(JSON.stringify(pm)).toMatch(/Abidjan/);
  });
});

// ─── 4. SUPERVISION RÉSEAU (CONTRACT-006) ────────────────────────────────────

describe("CONTRACT-013 F6-F11 — Supervision réseau (CONTRACT-006)", () => {
  it("network-overview en allow-list explicite : agrégats/compteurs, absence de PII documentée", () => {
    const nov = schemasOf(reporting)["NetworkOverviewResponse"];
    expect(nov, "NetworkOverviewResponse doit exister").toBeDefined();
    // additionalProperties: false = allow-list explicite
    expect(nov?.additionalProperties, "allow-list stricte (additionalProperties:false)").toBe(false);
    // documentation d'absence de PII
    expect(JSON.stringify(nov)).toMatch(/PII|personnelle|anonymis/i);
    // banques exposées par id + libellé uniquement (agrégats par banque)
    const banks = props(nov)["banks"];
    expect(banks, "agrégats par banque (id + libellé, compteurs)").toBeDefined();
  });

  it("Code d'erreur PLATFORM_READ_ONLY (403) documenté (allow-list mutations interdites)", () => {
    const raw = readFileSync(resolve(OPENAPI_DIR, "reporting.yaml"), "utf-8");
    expect(raw, "reporting.yaml doit documenter PLATFORM_READ_ONLY").toContain("PLATFORM_READ_ONLY");
  });
});

// ─── 5. QR (CONTRACT-003) ────────────────────────────────────────────────────

describe("CONTRACT-013 F6-F11 — QR signedAgencyToken (CONTRACT-003)", () => {
  it("AgencyQRPayload documente signedAgencyToken HMAC-SHA256, TTL 30 j, clé rotative versionnée", () => {
    const qp = schemasOf(publicDoc)["AgencyQRPayload"];
    const token = props(qp)["signedAgencyToken"];
    expect(token, "signedAgencyToken doit exister").toBeDefined();
    // versionnement de clé
    const p = props(qp);
    expect(p["keyVersion"], "keyVersion (clé rotative versionnée)").toBeDefined();
    const raw = readFileSync(resolve(OPENAPI_DIR, "public.yaml"), "utf-8");
    expect(raw, "format documenté HMAC-SHA256").toContain("HMAC-SHA256");
    expect(raw, "TTL 30 jours documenté").toMatch(/30\s*(j|jour|day)/i);
    expect(raw.toLowerCase(), "clé rotative / rotation").toMatch(/rotati|version/);
  });
});

// ─── 6. SOCKET.IO (CONTRACT-002) ─────────────────────────────────────────────

describe("CONTRACT-013 F6-F11 — Socket.io kiosk events (CONTRACT-002)", () => {
  it("kiosk:silent / kiosk:recovered / kiosk:status exportés avec les bons noms", () => {
    expect(kioskSilentEvent.name).toBe("kiosk:silent");
    expect(kioskRecoveredEvent.name).toBe("kiosk:recovered");
    expect(kioskStatusEvent.name).toBe("kiosk:status");
  });

  it("Chaque event est émis par api-server, room agency:{agencyId}, PII-free", () => {
    for (const ev of [kioskSilentEvent, kioskRecoveredEvent, kioskStatusEvent]) {
      expect(ev.emitter).toBe("api-server");
      expect(ev.room).toBe("agency:{agencyId}");
      const shape = ev.payloadSchema.parse({
        kioskId: "550e8400-e29b-41d4-a716-446655440000",
        agencyId: "550e8400-e29b-41d4-a716-446655440002",
        status: "SILENT",
        since: "2026-07-12T09:00:00.000Z",
      });
      expect(shape).toBeTruthy();
    }
  });

  it("Les payloads exigent agencyId (uuid) et le rejettent s'il est invalide", () => {
    for (const ev of [kioskSilentEvent, kioskRecoveredEvent, kioskStatusEvent]) {
      expect(() => ev.payloadSchema.parse({ kioskId: "x", agencyId: "pas-uuid" })).toThrow();
    }
  });

  it("ALL_EVENTS intègre les 3 nouveaux events sans casser l'existant", () => {
    const names = ALL_EVENTS.map((e) => e.name);
    for (const n of ["kiosk:silent", "kiosk:recovered", "kiosk:status"]) {
      expect(names, `${n} doit être dans ALL_EVENTS`).toContain(n);
    }
    // non-régression : les 11 events précédents restent
    for (const n of ["ticket:called", "join:agency", "sync:state", "kiosk:printer-error"]) {
      expect(names, `${n} doit rester`).toContain(n);
    }
    expect(ALL_EVENTS.length).toBeGreaterThanOrEqual(14);
  });
});

// ─── 7. IA (CONTRACT-008) ────────────────────────────────────────────────────

describe("CONTRACT-013 F6-F11 — IA (CONTRACT-008)", () => {
  it("AiMeta gagne featureSetVersion + availableDays (optionnels, non-breaking)", () => {
    const meta = schemasOf(ai)["AiMeta"];
    const p = props(meta);
    expect(p["featureSetVersion"], "featureSetVersion").toBeDefined();
    expect(p["availableDays"], "availableDays").toBeDefined();
    for (const added of ["featureSetVersion", "availableDays"]) {
      expect(required(meta), `${added} reste optionnel`).not.toContain(added);
    }
  });

  it("Forecast : drivers[] + lowConfidence (optionnels) sur ForecastHour", () => {
    const s = schemasOf(ai);
    expect(s["ForecastDriver"], "ForecastDriver doit exister").toBeDefined();
    const fh = s["ForecastHour"];
    expect(props(fh)["drivers"], "ForecastHour.drivers").toBeDefined();
    expect(props(fh)["lowConfidence"], "ForecastHour.lowConfidence").toBeDefined();
    expect(required(fh), "drivers reste optionnel").not.toContain("drivers");
  });

  it("Anomalies : evidence structuré (optionnel) sur Anomaly", () => {
    const s = schemasOf(ai);
    expect(s["AnomalyEvidence"], "AnomalyEvidence doit exister").toBeDefined();
    const an = s["Anomaly"];
    expect(props(an)["evidence"], "Anomaly.evidence").toBeDefined();
    expect(required(an), "evidence reste optionnel").not.toContain("evidence");
    // forme : metric/threshold/window/sample
    const ev = s["AnomalyEvidence"];
    for (const f of ["metric", "threshold", "window", "sample"]) {
      expect(props(ev)[f], `AnomalyEvidence.${f}`).toBeDefined();
    }
  });

  it("Feedback-insights : themes[] (enum fermé), qualityScore décomposé, INSUFFICIENT_SAMPLE, language:unsupported", () => {
    const s = schemasOf(ai);
    // enum fermé de thèmes
    const themeEnum = s["FeedbackTheme"];
    expect(themeEnum, "FeedbackTheme enum doit exister").toBeDefined();
    expect(enumOf(themeEnum).length, "enum fermé non vide").toBeGreaterThan(0);
    // themes[] additionnel (optionnel) sur la réponse
    const fir = s["FeedbackInsightsResponse"];
    expect(props(fir)["themes"], "FeedbackInsightsResponse.themes").toBeDefined();
    expect(required(fir), "themes reste optionnel").not.toContain("themes");
    // qualityScore décomposé
    expect(props(s["QualityScore"])["components"], "QualityScore.components (décomposition)").toBeDefined();
    // language: unsupported
    const lang = s["FeedbackLanguage"];
    expect(lang, "FeedbackLanguage doit exister").toBeDefined();
    expect(enumOf(lang), "language:unsupported").toContain("unsupported");
    // INSUFFICIENT_SAMPLE documenté
    const raw = readFileSync(resolve(OPENAPI_DIR, "ai.yaml"), "utf-8");
    expect(raw, "ai.yaml doit documenter INSUFFICIENT_SAMPLE").toContain("INSUFFICIENT_SAMPLE");
  });
});
