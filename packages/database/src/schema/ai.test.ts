import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  aiForecasts,
  aiStaffingRecommendations,
  aiAnomalies,
  aiQualityScores,
  contextualFactorEnum,
  staffingAckStatusEnum,
  anomalyTypeEnum,
  anomalyStatusEnum,
} from "./ai.js";

/**
 * DB-007 — Tests structurels du schéma IA (in-process, sans base).
 *
 * Vérifient les colonnes, contraintes, enums et conformité données personnelles
 * pour les 4 tables IA (ai_forecasts, ai_staffing_recommendations, ai_anomalies,
 * ai_quality_scores).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Alignement enums LA LOI (ai.yaml)
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-007: enums alignés LA LOI (ai.yaml)", () => {
  it("DB-007: ContextualFactor Drizzle === LA LOI (5 valeurs : END_OF_MONTH/CIVIL_SERVICE_PAY/PUBLIC_HOLIDAY/SCHOOL_START/NONE)", () => {
    expect(contextualFactorEnum.enumValues).toEqual([
      "END_OF_MONTH",
      "CIVIL_SERVICE_PAY",
      "PUBLIC_HOLIDAY",
      "SCHOOL_START",
      "NONE",
    ]);
  });

  it("DB-007: StaffingAckStatus Drizzle === LA LOI (2 valeurs : PENDING/ACKED)", () => {
    expect(staffingAckStatusEnum.enumValues).toEqual(["PENDING", "ACKED"]);
  });

  it("DB-007: AnomalyType Drizzle === LA LOI (3 valeurs : QUEUE_STUCK/AGENT_INACTIVE_PATTERN/SLA_SYSTEMIC)", () => {
    expect(anomalyTypeEnum.enumValues).toEqual([
      "QUEUE_STUCK",
      "AGENT_INACTIVE_PATTERN",
      "SLA_SYSTEMIC",
    ]);
  });

  it("DB-007: AnomalyStatus Drizzle === LA LOI (3 valeurs : open/acked/resolved)", () => {
    expect(anomalyStatusEnum.enumValues).toEqual(["open", "acked", "resolved"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Table ai_forecasts
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-007: modèle ai_forecasts (structure)", () => {
  it("DB-007: ai_forecasts — colonnes requises présentes (bank_id, agency_id, target_date, hour, expected_tickets, confidence, factors, model_version, computed_at, data_window)", () => {
    const config = getTableConfig(aiForecasts);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("bank_id");
    expect(names).toContain("agency_id");
    expect(names).toContain("target_date");
    expect(names).toContain("hour");
    expect(names).toContain("expected_tickets");
    expect(names).toContain("confidence");
    expect(names).toContain("factors");
    expect(names).toContain("model_version");
    expect(names).toContain("computed_at");
    expect(names).toContain("data_window");
    expect(names).toContain("created_at");
  });

  it("DB-007: ai_forecasts — bank_id NOT NULL (tenant obligatoire)", () => {
    const config = getTableConfig(aiForecasts);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
  });

  it("DB-007: ai_forecasts — index unique (bank_id, agency_id, target_date, hour, model_version) nommé", () => {
    const config = getTableConfig(aiForecasts);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("ai_forecasts_unique_forecast");
  });

  it("DB-007: ai_forecasts — aucun champ personnel (zéro données personnelles)", () => {
    const config = getTableConfig(aiForecasts);
    const names = config.columns.map((c) => c.name);
    const personalFields = names.filter(
      (n) =>
        n === "phone" ||
        n === "email" ||
        n === "first_name" ||
        n === "last_name" ||
        n === "user_id" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(personalFields, "ai_forecasts ne doit contenir aucun champ personnel").toHaveLength(0);
  });

  it("DB-007: ai_forecasts — factors est JSONB (enum facteurs LA LOI)", () => {
    const config = getTableConfig(aiForecasts);
    const factors = config.columns.find((c) => c.name === "factors");
    expect(factors).toBeDefined();
    // jsonb column
    expect(factors?.columnType).toBe("PgJsonb");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Table ai_staffing_recommendations
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-007: modèle ai_staffing_recommendations (structure)", () => {
  it("DB-007: ai_staffing_recommendations — colonnes requises présentes", () => {
    const config = getTableConfig(aiStaffingRecommendations);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("bank_id");
    expect(names).toContain("agency_id");
    expect(names).toContain("target_date");
    expect(names).toContain("time");
    expect(names).toContain("action");
    expect(names).toContain("counters");
    expect(names).toContain("rationale");
    expect(names).toContain("status");
    expect(names).toContain("acked_by");
    expect(names).toContain("acked_at");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("DB-007: ai_staffing_recommendations — status enum PENDING/ACKED", () => {
    const config = getTableConfig(aiStaffingRecommendations);
    const statusCol = config.columns.find((c) => c.name === "status");
    expect(statusCol?.columnType).toBe("PgEnumColumn");
  });

  it("DB-007: ai_staffing_recommendations — bank_id NOT NULL", () => {
    const config = getTableConfig(aiStaffingRecommendations);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    expect(bankId?.notNull).toBe(true);
  });

  it("DB-007: ai_staffing_recommendations — acked_by nullable (optionnel avant acquittement)", () => {
    const config = getTableConfig(aiStaffingRecommendations);
    const ackedBy = config.columns.find((c) => c.name === "acked_by");
    expect(ackedBy?.notNull).toBeFalsy();
  });

  it("DB-007: ai_staffing_recommendations — aucun champ personnel", () => {
    const config = getTableConfig(aiStaffingRecommendations);
    const names = config.columns.map((c) => c.name);
    const personalFields = names.filter(
      (n) =>
        n === "phone" ||
        n === "email" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(personalFields).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Table ai_anomalies
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-007: modèle ai_anomalies (structure)", () => {
  it("DB-007: ai_anomalies — colonnes requises présentes", () => {
    const config = getTableConfig(aiAnomalies);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("bank_id");
    expect(names).toContain("agency_id");
    expect(names).toContain("type");
    expect(names).toContain("status");
    expect(names).toContain("payload");
    expect(names).toContain("detected_at");
    expect(names).toContain("acked_by");
    expect(names).toContain("acked_at");
    expect(names).toContain("resolved_at");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("DB-007: ai_anomalies — type est enum AnomalyType (QUEUE_STUCK/AGENT_INACTIVE_PATTERN/SLA_SYSTEMIC)", () => {
    const config = getTableConfig(aiAnomalies);
    const typeCol = config.columns.find((c) => c.name === "type");
    expect(typeCol?.columnType).toBe("PgEnumColumn");
  });

  it("DB-007: ai_anomalies — status est enum AnomalyStatus (open/acked/resolved)", () => {
    const config = getTableConfig(aiAnomalies);
    const statusCol = config.columns.find((c) => c.name === "status");
    expect(statusCol?.columnType).toBe("PgEnumColumn");
  });

  it("DB-007: ai_anomalies — index (bank_id, status, detected_at) nommé", () => {
    const config = getTableConfig(aiAnomalies);
    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("ai_anomalies_bank_status_detected_idx");
  });

  it("DB-007: ai_anomalies — bank_id NOT NULL, agency_id nullable (anomalie peut être au niveau banque)", () => {
    const config = getTableConfig(aiAnomalies);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    const agencyId = config.columns.find((c) => c.name === "agency_id");
    expect(bankId?.notNull).toBe(true);
    expect(agencyId?.notNull).toBeFalsy();
  });

  it("DB-007: ai_anomalies — acked_at, resolved_at nullable (horodatages de cycle)", () => {
    const config = getTableConfig(aiAnomalies);
    const ackedAt = config.columns.find((c) => c.name === "acked_at");
    const resolvedAt = config.columns.find((c) => c.name === "resolved_at");
    expect(ackedAt?.notNull).toBeFalsy();
    expect(resolvedAt?.notNull).toBeFalsy();
  });

  it("DB-007: ai_anomalies — aucun champ personnel (zéro PII)", () => {
    const config = getTableConfig(aiAnomalies);
    const names = config.columns.map((c) => c.name);
    const personalFields = names.filter(
      (n) =>
        n === "phone" ||
        n === "email" ||
        n === "first_name" ||
        n === "last_name" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(personalFields).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Table ai_quality_scores
// ─────────────────────────────────────────────────────────────────────────────

describe("DB-007: modèle ai_quality_scores (structure)", () => {
  it("DB-007: ai_quality_scores — colonnes requises présentes", () => {
    const config = getTableConfig(aiQualityScores);
    const names = config.columns.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("bank_id");
    expect(names).toContain("agency_id");
    expect(names).toContain("agent_id");
    expect(names).toContain("period");
    expect(names).toContain("score");
    expect(names).toContain("components");
    expect(names).toContain("model_version");
    expect(names).toContain("created_at");
    expect(names).toContain("updated_at");
  });

  it("DB-007: ai_quality_scores — bank_id + agency_id NOT NULL", () => {
    const config = getTableConfig(aiQualityScores);
    const bankId = config.columns.find((c) => c.name === "bank_id");
    const agencyId = config.columns.find((c) => c.name === "agency_id");
    expect(bankId?.notNull).toBe(true);
    expect(agencyId?.notNull).toBe(true);
  });

  it("DB-007: ai_quality_scores — agent_id nullable (agrégats anonymisés — pas de référence individuelle obligatoire)", () => {
    const config = getTableConfig(aiQualityScores);
    const agentId = config.columns.find((c) => c.name === "agent_id");
    expect(agentId?.notNull).toBeFalsy();
  });

  it("DB-007: ai_quality_scores — components est JSONB", () => {
    const config = getTableConfig(aiQualityScores);
    const components = config.columns.find((c) => c.name === "components");
    expect(components?.columnType).toBe("PgJsonb");
  });

  it("DB-007: ai_quality_scores — aucun champ personnel brut (anonymisés uniquement)", () => {
    const config = getTableConfig(aiQualityScores);
    const names = config.columns.map((c) => c.name);
    const personalFields = names.filter(
      (n) =>
        n === "phone" ||
        n === "email" ||
        n === "first_name" ||
        n === "last_name" ||
        (n.includes("phone") && !n.endsWith("_hash") && !n.endsWith("_encrypted"))
    );
    expect(personalFields).toHaveLength(0);
  });

  it("DB-007: ai_quality_scores — index (bank_id, agency_id, period) bank_id-first", () => {
    const config = getTableConfig(aiQualityScores);
    const hasFirstBankId = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        "name" in first &&
        (first as { name: string }).name === "bank_id"
      );
    });
    expect(hasFirstBankId, "ai_quality_scores doit avoir un index bank_id-first").toBe(true);
  });
});
