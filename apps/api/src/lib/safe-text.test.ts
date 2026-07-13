/**
 * Tests unitaires — refinement `safeText` anti-caractères de contrôle.
 *
 * Prouve : octet NUL / C0 interdits → rejet ; Unicode accentué (FR)
 * préservé ; `\t`/`\n`/`\r` autorisés ; chaînage `.min`/`.max`/
 * `.optional` fonctionnel.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  safeText,
  hasForbiddenControlChar,
  CONTROL_CHAR_MESSAGE,
} from "src/lib/safe-text.js";

describe("safeText — durcissement anti-octet-NUL / contrôle C0", () => {
  it("rejette un octet NUL (\\x00) — la cause du 500 PostgreSQL 22021", () => {
    const r = safeText().safeParse("ab\x00cd");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe(CONTROL_CHAR_MESSAGE);
  });

  it("rejette les autres caractères de contrôle C0 interdits", () => {
    for (const ch of ["\x01", "\x07", "\x08", "\x0B", "\x0C", "\x1B", "\x1F"]) {
      expect(safeText().safeParse(`x${ch}y`).success).toBe(false);
    }
  });

  it("autorise tab / saut de ligne / retour chariot", () => {
    expect(safeText().safeParse("l1\nl2\tfin\r").success).toBe(true);
  });

  it("PRÉSERVE l'Unicode accentué FR (non filtré)", () => {
    for (const s of [
      "Agence Générale Abidjan",
      "Service Épargne",
      "çà ô é à ù î ",
      "Cœur d'Ivoire — Yamoussoukro",
    ]) {
      expect(safeText().safeParse(s).success).toBe(true);
    }
  });

  it("se compose avec .min / .max / .optional", () => {
    const schema = z
      .object({ name: safeText().min(1), note: safeText().max(5).optional() })
      .strict();
    expect(schema.safeParse({ name: "" }).success).toBe(false);
    expect(schema.safeParse({ name: "ok" }).success).toBe(true);
    expect(schema.safeParse({ name: "ok", note: undefined }).success).toBe(true);
    expect(schema.safeParse({ name: "ok", note: "toolong" }).success).toBe(false);
    expect(schema.safeParse({ name: "ok", note: "a\x00" }).success).toBe(false);
  });

  it("hasForbiddenControlChar : prédicat direct", () => {
    expect(hasForbiddenControlChar("clean")).toBe(false);
    expect(hasForbiddenControlChar("dirty\x00")).toBe(true);
    expect(hasForbiddenControlChar("ok\ttab")).toBe(false);
  });
});
