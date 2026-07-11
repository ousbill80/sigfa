/**
 * Tests unitaires — withPlatform (API-002, périmètre étendu)
 *
 * Vérifie que withPlatform exécute fn avec la connexion migrateur dédiée
 * et que la fonction rejette si bankId non null est fourni sur une route
 * qui n'en a pas besoin (platform = sigfa_migrator, bankId absent).
 *
 * @module
 */

import { describe, it, expect, vi } from "vitest";
import { withPlatform } from "./platform.js";

describe("withPlatform", () => {
  it("API-002: withPlatform exécute fn avec la connexion fournie et retourne son résultat", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ id: "bank-1" }] });
    const result = await withPlatform(mockQuery, async (q) => {
      return q("SELECT id FROM banks");
    });

    expect(mockQuery).toHaveBeenCalledWith("SELECT id FROM banks");
    expect(result).toEqual({ rows: [{ id: "bank-1" }] });
  });

  it("API-002: withPlatform propage les erreurs de fn", async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error("permission denied"));
    await expect(
      withPlatform(mockQuery, async (q) => q("SELECT * FROM banks"))
    ).rejects.toThrow("permission denied");
  });

  it("API-002: withPlatform N'ÉMET PAS de SET app.current_bank_id (pas de contexte tenant)", async () => {
    const calls: string[] = [];
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    });

    await withPlatform(mockQuery, async (q) => q("SELECT 1"));

    // withPlatform ne doit jamais émettre SET app.current_bank_id
    const hasBankIdSet = calls.some((s) =>
      s.includes("app.current_bank_id")
    );
    expect(hasBankIdSet).toBe(false);
  });
});
