/**
 * Tests unitaires — backup-config (SEC-003).
 * Nommage strict : `SEC-003: <description>`.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAILY_RETENTION_DAYS,
  DEFAULT_HOURLY_RETENTION_HOURS,
  RPO_TARGET_MINUTES,
  RTO_TARGET_MINUTES,
  cadencePrefix,
  getRetentionPolicy,
} from "src/pra/backup-config.js";

describe("backup-config", () => {
  it("SEC-003: cibles RPO/RTO verrouillées (60 min / 15 min)", () => {
    expect(RPO_TARGET_MINUTES).toBe(60);
    expect(RTO_TARGET_MINUTES).toBe(15);
  });

  it("SEC-003: rétention par défaut = 48 h horaire / 30 j quotidien", () => {
    const p = getRetentionPolicy({} as NodeJS.ProcessEnv);
    expect(p.hourlyRetentionHours).toBe(DEFAULT_HOURLY_RETENTION_HOURS);
    expect(p.dailyRetentionDays).toBe(DEFAULT_DAILY_RETENTION_DAYS);
    expect(p.hourlyRetentionHours).toBe(48);
    expect(p.dailyRetentionDays).toBe(30);
  });

  it("SEC-003: rétention paramétrable par variables d'environnement", () => {
    const p = getRetentionPolicy({
      BACKUP_HOURLY_RETENTION_HOURS: "72",
      BACKUP_DAILY_RETENTION_DAYS: "90",
    } as NodeJS.ProcessEnv);
    expect(p.hourlyRetentionHours).toBe(72);
    expect(p.dailyRetentionDays).toBe(90);
  });

  it("SEC-003: valeur invalide/négative retombe sur le défaut sûr", () => {
    const p = getRetentionPolicy({
      BACKUP_HOURLY_RETENTION_HOURS: "-5",
      BACKUP_DAILY_RETENTION_DAYS: "abc",
    } as NodeJS.ProcessEnv);
    expect(p.hourlyRetentionHours).toBe(48);
    expect(p.dailyRetentionDays).toBe(30);
  });

  it("SEC-003: cadencePrefix classe hourly/daily dans des préfixes distincts", () => {
    expect(cadencePrefix("hourly")).toBe("backups/hourly/");
    expect(cadencePrefix("daily")).toBe("backups/daily/");
  });
});
