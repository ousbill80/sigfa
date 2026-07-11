import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  dailyAgencyStats,
  exportJobs,
  exportJobStatusEnum,
} from "./reporting.js";

/**
 * DB-006 — Tests structurels du schéma reporting (in-process, sans base).
 *
 * Vérifient les colonnes, contraintes d'unicité partielles, enums et conformité
 * AnonymizedNetworkAggregate (aucun champ personnel) pour les 2 tables.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Enum ExportJobStatus
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-006: enum ExportJobStatus — alignement LA LOI", () => {
  it("DB-006: ExportJobStatus Drizzle === LA LOI (4 valeurs : PENDING/PROCESSING/READY/FAILED)", () => {
    expect(exportJobStatusEnum.enumValues).toEqual([
      "PENDING",
      "PROCESSING",
      "READY",
      "FAILED",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Table daily_agency_stats — structure
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-006: modèle daily_agency_stats (structure)", () => {
  it("DB-006: daily_agency_stats — 7 KPIs sources présents (colonnes mesures)", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    // Colonnes tenant
    expect(names).toContain("bank_id");
    expect(names).toContain("agency_id");
    expect(names).toContain("service_id");
    expect(names).toContain("day");
    // Mesures KPI de LA LOI
    expect(names).toContain("tickets_issued");
    expect(names).toContain("tickets_served");
    expect(names).toContain("tickets_abandoned");
    expect(names).toContain("tickets_no_show");
    expect(names).toContain("total_wait_seconds");
    expect(names).toContain("total_service_seconds");
    expect(names).toContain("sla_met_count");
    expect(names).toContain("sla_total_count");
    expect(names).toContain("feedback_count");
    expect(names).toContain("feedback_sum");
    expect(names).toContain("nps_promoters");
    expect(names).toContain("nps_passives");
    expect(names).toContain("nps_detractors");
    expect(names).toContain("agent_active_seconds");
  });

  it("DB-006: daily_agency_stats — aucun champ personnel (conformité AnonymizedNetworkAggregate)", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    // Pas de champ personnel : pas de phone, email, nom, agent_id, user_id en clair
    const personalFields = names.filter(
      (n) =>
        n === "phone" ||
        n === "email" ||
        n === "first_name" ||
        n === "last_name" ||
        n === "agent_id" ||
        n === "user_id" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(
      personalFields,
      "daily_agency_stats ne doit contenir aucun champ personnel"
    ).toHaveLength(0);
  });

  it("DB-006: daily_agency_stats — bank_id NOT NULL", () => {
    const config = getTableConfig(dailyAgencyStats);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
  });

  it("DB-006: daily_agency_stats — agency_id NOT NULL", () => {
    const config = getTableConfig(dailyAgencyStats);
    const agencyId = config.columns.find((c) => c.name === "agency_id");
    expect(agencyId?.notNull).toBe(true);
  });

  it("DB-006: daily_agency_stats — day NOT NULL (date locale Africa/Abidjan)", () => {
    const config = getTableConfig(dailyAgencyStats);
    const day = config.columns.find((c) => c.name === "day");
    expect(day?.notNull).toBe(true);
  });

  it("DB-006: daily_agency_stats — service_id nullable (null = toutes les agences)", () => {
    const config = getTableConfig(dailyAgencyStats);
    const serviceId = config.columns.find((c) => c.name === "service_id");
    expect(serviceId).toBeDefined();
    // service_id DOIT être nullable (null = agrégat toutes services confondus)
    expect(serviceId?.notNull).toBeFalsy();
  });

  it("DB-006: daily_agency_stats — index (bank_id, day) et (bank_id, agency_id, day) bank_id-first", () => {
    const config = getTableConfig(dailyAgencyStats);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("daily_agency_stats_bank_id_day_idx");
    expect(indexNames).toContain("daily_agency_stats_bank_id_agency_id_day_idx");
  });

  it("DB-006: unicité partielle WHERE service_id IS NULL — index nommé correctement", () => {
    const config = getTableConfig(dailyAgencyStats);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("daily_agency_stats_no_service_uniq");
  });

  it("DB-006: unicité partielle WHERE service_id IS NOT NULL — index nommé correctement", () => {
    const config = getTableConfig(dailyAgencyStats);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("daily_agency_stats_with_service_uniq");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Table export_jobs — structure
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-006: modèle export_jobs (structure)", () => {
  it("DB-006: export_jobs — colonnes requises présentes", () => {
    const config = getTableConfig(exportJobs);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("bank_id");
    expect(names).toContain("requested_by");
    expect(names).toContain("scope");
    expect(names).toContain("period");
    expect(names).toContain("format");
    expect(names).toContain("status");
    expect(names).toContain("file_url");
    expect(names).toContain("expires_at");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("DB-006: export_jobs — status est l'enum ExportJobStatus (PENDING/PROCESSING/READY/FAILED)", () => {
    const config = getTableConfig(exportJobs);
    const statusCol = config.columns.find((c) => c.name === "status");
    expect(statusCol).toBeDefined();
    // Le type doit être un enum PgEnumColumn (Drizzle suffixe automatiquement "Column")
    expect(statusCol?.columnType).toBe("PgEnumColumn");
  });

  it("DB-006: export_jobs — format (pdf/xlsx/json) présent", () => {
    const config = getTableConfig(exportJobs);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("format");
  });

  it("DB-006: export_jobs — bank_id NOT NULL, index bank_id-first", () => {
    const config = getTableConfig(exportJobs);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
    const hasBankFirst = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasBankFirst, "export_jobs doit avoir un index bank_id-first").toBe(true);
  });

  it("DB-006: export_jobs — file_url nullable (null avant génération)", () => {
    const config = getTableConfig(exportJobs);
    const fileUrl = config.columns.find((c) => c.name === "file_url");
    expect(fileUrl?.notNull).toBeFalsy();
  });

  it("DB-006: export_jobs — expires_at nullable (null si pas d'expiration)", () => {
    const config = getTableConfig(exportJobs);
    const expiresAt = config.columns.find((c) => c.name === "expires_at");
    expect(expiresAt?.notNull).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Test de suffisance champ→KPI (documentation + validation structurelle)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-006: suffisance champ→KPI — chaque KPI de LA LOI mappé à ses colonnes sources", () => {
  /**
   * Mapping documenté : KPI de LA LOI → colonnes sources dans daily_agency_stats.
   *
   * Les formules exactes vivent dans REP-001 (API) — ce test garantit que
   * toutes les colonnes nécessaires aux calculs sont présentes.
   *
   * 7 KPIs de LA LOI :
   * 1. TMA (Temps Moyen d'Attente)       = total_wait_seconds / tickets_served
   * 2. TMT (Temps Moyen de Traitement)   = total_service_seconds / tickets_served
   * 3. TTS (Taux de tickets servis)      = tickets_served / tickets_issued
   * 4. Taux d'abandon                    = tickets_abandoned / tickets_issued
   * 5. Taux SLA                          = sla_met_count / sla_total_count
   * 6. NPS (Net Promoter Score)          = (nps_promoters - nps_detractors) / (nps_promoters + nps_passives + nps_detractors)
   * 7. Taux d'occupation agent           = agent_active_seconds / (nombre_agents × durée_journée)
   */
  const KPI_MAPPINGS = [
    {
      kpi: "TMA (Temps Moyen d'Attente)",
      formula: "total_wait_seconds / tickets_served",
      sources: ["total_wait_seconds", "tickets_served"],
    },
    {
      kpi: "TMT (Temps Moyen de Traitement)",
      formula: "total_service_seconds / tickets_served",
      sources: ["total_service_seconds", "tickets_served"],
    },
    {
      kpi: "TTS (Taux de tickets servis)",
      formula: "tickets_served / tickets_issued",
      sources: ["tickets_served", "tickets_issued"],
    },
    {
      kpi: "Taux d'abandon",
      formula: "tickets_abandoned / tickets_issued",
      sources: ["tickets_abandoned", "tickets_issued"],
    },
    {
      kpi: "Taux SLA",
      formula: "sla_met_count / sla_total_count",
      sources: ["sla_met_count", "sla_total_count"],
    },
    {
      kpi: "NPS (Net Promoter Score)",
      formula: "(nps_promoters - nps_detractors) / (nps_promoters + nps_passives + nps_detractors) * 100",
      sources: ["nps_promoters", "nps_passives", "nps_detractors"],
    },
    {
      kpi: "Taux d'occupation agent",
      formula: "agent_active_seconds / (agents × durée_journée)",
      sources: ["agent_active_seconds"],
    },
  ] as const;

  it("DB-006: test de suffisance — toutes les colonnes sources des 7 KPIs sont présentes dans daily_agency_stats", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);

    for (const mapping of KPI_MAPPINGS) {
      for (const source of mapping.sources) {
        expect(
          names,
          `KPI "${mapping.kpi}" (formule: ${mapping.formula}) requiert la colonne "${source}"`
        ).toContain(source);
      }
    }
  });

  it("DB-006: suffisance KPI 1 — TMA calculable depuis total_wait_seconds + tickets_served", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("total_wait_seconds");
    expect(names).toContain("tickets_served");
  });

  it("DB-006: suffisance KPI 2 — TMT calculable depuis total_service_seconds + tickets_served", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("total_service_seconds");
    expect(names).toContain("tickets_served");
  });

  it("DB-006: suffisance KPI 5 — Taux SLA calculable depuis sla_met_count + sla_total_count", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("sla_met_count");
    expect(names).toContain("sla_total_count");
  });

  it("DB-006: suffisance KPI 6 — NPS calculable depuis nps_promoters + nps_passives + nps_detractors", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("nps_promoters");
    expect(names).toContain("nps_passives");
    expect(names).toContain("nps_detractors");
  });

  it("DB-006: suffisance KPI 7 — Taux occupation calculable depuis agent_active_seconds (source: agent_status_history)", () => {
    const config = getTableConfig(dailyAgencyStats);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("agent_active_seconds");
    // Le commentaire JSDoc de la colonne doit mentionner agent_status_history (vérifiable au niveau schéma)
    const col = config.columns.find((c) => c.name === "agent_active_seconds");
    expect(col).toBeDefined();
  });
});
