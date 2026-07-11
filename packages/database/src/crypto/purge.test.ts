/**
 * DB-008 — Suite de tests d'intégration : purge « droit à l'oubli » (UEMOA 13 mois)
 *
 * TDD rouge→vert : ces tests échouent AVANT la migration 0006 et l'implémentation
 * de `purge.ts`. PostgreSQL réelle via Testcontainers (double rôle sigfa_app /
 * sigfa_migrator) — aucun mock (LA LOI T5).
 *
 * Couvre :
 *   - `retention_policies` : borne 1–60, défaut 13, RLS + tenant-isolation ;
 *   - `purgeExpiredPhones()` : anonymisation des tickets clos > rétention et des
 *     consentements révoqués expirés, idempotent, horloge injectable ;
 *   - `purgePhone(bankId, phone)` : anonymisation de toutes les occurrences,
 *     idempotent, `{ purged, affectedTickets }` ;
 *   - entrée `audit_log` DATA_PURGE sans téléphone en clair (hash tronqué).
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import { withTenant } from "src/tenant.js";

// Clés fournies pour le module de chiffrement — DÉFINIES AVANT l'import dynamique
// (le module valide ses clés au chargement : fail-fast DB-008).
process.env.PHONE_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.PHONE_HASH_KEY ??= "sigfa-test-hmac-key-db008";

const { encryptPhone, hashPhone } = await import("src/crypto/phone-cipher.js");
const { purgeExpiredPhones, purgePhone } = await import("src/crypto/purge.js");

const BANK_A = "aaaaaaaa-0000-4000-8000-00000000db08";
const BANK_B = "bbbbbbbb-0000-4000-8000-00000000db08";
const AGENCY_A = "aa000000-0000-4000-8000-00000000db08";
const SERVICE_A = "5e000000-0000-4000-8000-00000000db08";
const QUEUE_A = "ce000000-0000-4000-8000-00000000db08";
const ACTOR_ID = "cc000000-0000-4000-8000-00000000db08";

const PHONE_1 = "+2250700000001";
const PHONE_2 = "+2250700000002";

/** Horloge fixe pour les tests (10 juillet 2026). */
const NOW = new Date("2026-07-10T12:00:00.000Z");

/**
 * Insère un ticket avec téléphone chiffré + hash pour les tests.
 * @param harness - Harness PG
 * @param id      - UUID du ticket
 * @param opts    - Options (numéro, statut, phone, closedAt, number séquentiel)
 */
async function insertTicket(
  harness: DualConnectionHarness,
  id: string,
  opts: {
    bankId: string;
    number: number;
    status: string;
    phone: string;
    issuedAt: string;
    closedAt: string | null;
  }
): Promise<void> {
  const enc = encryptPhone(opts.phone);
  const hash = hashPhone(opts.phone);
  const closed = opts.closedAt === null ? "NULL" : `'${opts.closedAt}'`;
  await harness.query(`
    INSERT INTO tickets (
      id, bank_id, agency_id, queue_id, service_id,
      number, tracking_id, channel, status,
      phone_encrypted, phone_hash, sms_consent,
      issued_at, closed_at
    ) VALUES (
      '${id}', '${opts.bankId}', '${AGENCY_A}', '${QUEUE_A}', '${SERVICE_A}',
      ${opts.number}, 'trk-${id.slice(0, 17)}', 'KIOSK', '${opts.status}',
      '${enc}', '${hash}', true,
      '${opts.issuedAt}', ${closed}
    )
  `);
}

describe("DB-008 — purge droit à l'oubli (intégration PG16, Testcontainers)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    await harness.query(`
      INSERT INTO banks (id, name, slug) VALUES
        ('${BANK_A}', 'Banque A DB008', 'banque-a-db008'),
        ('${BANK_B}', 'Banque B DB008', 'banque-b-db008')
      ON CONFLICT (id) DO NOTHING
    `);
    await harness.query(`
      INSERT INTO agencies (id, bank_id, name) VALUES
        ('${AGENCY_A}', '${BANK_A}', 'Agence A1 DB008')
      ON CONFLICT (id) DO NOTHING
    `);
    await harness.query(`
      INSERT INTO services (id, bank_id, agency_id, name, code) VALUES
        ('${SERVICE_A}', '${BANK_A}', '${AGENCY_A}', 'Service DB008', 'DHU')
      ON CONFLICT (id) DO NOTHING
    `);
    await harness.query(`
      INSERT INTO queues (id, bank_id, agency_id, service_id) VALUES
        ('${QUEUE_A}', '${BANK_A}', '${AGENCY_A}', '${SERVICE_A}')
      ON CONFLICT (id) DO NOTHING
    `);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  // Réinitialiser l'état mutable entre les tests (via migrateur, BYPASSRLS).
  beforeEach(async () => {
    await harness.query(`DELETE FROM tickets WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
    await harness.query(`DELETE FROM notification_consents WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
    await harness.query(`DELETE FROM retention_policies WHERE bank_id IN ('${BANK_A}', '${BANK_B}')`);
    await harness.query(`TRUNCATE audit_log`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Critère : retention_policies borné 1–60, défaut 13, RLS + tenant-isolation
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: retention_policies borné 1–60, défaut 13, RLS + tenant-isolation (tests)",
    async () => {
      // Défaut 13 mois lorsqu'aucune valeur n'est fournie.
      await harness.query(`
        INSERT INTO retention_policies (id, bank_id) VALUES (gen_random_uuid(), '${BANK_A}')
      `);
      const def = await harness.query(`
        SELECT phone_retention_months FROM retention_policies WHERE bank_id = '${BANK_A}'
      `);
      expect(Number(def.rows[0]!.phone_retention_months)).toBe(13);

      // Borne basse : 0 → rejet (CHECK 1..60).
      await expect(
        harness.query(`
          INSERT INTO retention_policies (id, bank_id, phone_retention_months)
          VALUES (gen_random_uuid(), '${BANK_B}', 0)
        `)
      ).rejects.toThrow();

      // Borne haute : 61 → rejet.
      await expect(
        harness.query(`
          INSERT INTO retention_policies (id, bank_id, phone_retention_months)
          VALUES (gen_random_uuid(), '${BANK_B}', 61)
        `)
      ).rejects.toThrow();

      // Valeur dans les bornes (60) → accepté.
      await harness.query(`
        INSERT INTO retention_policies (id, bank_id, phone_retention_months)
        VALUES (gen_random_uuid(), '${BANK_B}', 60)
      `);

      // RLS ENABLED + FORCED + policy tenant_isolation.
      const rls = await harness.query(`
        SELECT pc.relrowsecurity, pc.relforcerowsecurity
        FROM pg_class pc
        WHERE pc.relname = 'retention_policies' AND pc.relnamespace = 'public'::regnamespace
      `);
      expect(rls.rows[0]!.relrowsecurity).toBe(true);
      expect(rls.rows[0]!.relforcerowsecurity).toBe(true);

      const policy = await harness.query(`
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'retention_policies'
          AND policyname = 'tenant_isolation'
      `);
      expect(policy.rows).toHaveLength(1);

      // Tenant-isolation réelle : contexte A ne voit que sa politique.
      const rowsA = await withTenant(harness.appQuery.bind(harness), BANK_A, async (q) => {
        const res = await q("SELECT bank_id FROM retention_policies");
        return res.rows as Array<{ bank_id: string }>;
      });
      for (const row of rowsA) {
        expect(row.bank_id).toBe(BANK_A);
      }

      // Unicité : une seule politique par banque.
      await expect(
        harness.query(`
          INSERT INTO retention_policies (id, bank_id) VALUES (gen_random_uuid(), '${BANK_A}')
        `)
      ).rejects.toThrow();
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère : ticket clos >13 mois → purgé ; <13 mois → intact ; rejeu idempotent
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: ticket clos >13 mois → purgé ; <13 mois → intact ; rejeu → idempotent (horloge contrôlée)",
    async () => {
      // Ticket A1 : clos il y a 14 mois → doit être purgé (défaut 13).
      await insertTicket(harness, "d0080001-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 1,
        status: "DONE",
        phone: PHONE_1,
        issuedAt: "2025-05-01T09:00:00Z",
        closedAt: "2025-05-01T09:30:00Z", // > 13 mois avant NOW (2026-07-10)
      });
      // Ticket A2 : clos il y a 2 mois → doit rester intact.
      await insertTicket(harness, "d0080002-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 2,
        status: "DONE",
        phone: PHONE_2,
        issuedAt: "2026-05-01T09:00:00Z",
        closedAt: "2026-05-10T09:30:00Z", // < 13 mois
      });
      // Ticket A3 : encore ouvert (WAITING), issued il y a longtemps mais non clos → intact.
      await insertTicket(harness, "d0080003-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 3,
        status: "WAITING",
        phone: PHONE_1,
        issuedAt: "2024-01-01T09:00:00Z",
        closedAt: null,
      });

      const first = await purgeExpiredPhones(harness.query.bind(harness), { now: NOW });
      // Au moins le ticket A1 anonymisé.
      expect(first.anonymizedTickets).toBeGreaterThanOrEqual(1);

      // A1 anonymisé : phone_encrypted et phone_hash NULL, mais la ligne demeure.
      const a1 = await harness.query(`
        SELECT phone_encrypted, phone_hash, status FROM tickets
        WHERE id = 'd0080001-0000-4000-8000-00000000db08'
      `);
      expect(a1.rows).toHaveLength(1);
      expect(a1.rows[0]!.phone_encrypted).toBeNull();
      expect(a1.rows[0]!.phone_hash).toBeNull();
      expect(a1.rows[0]!.status).toBe("DONE"); // le ticket agrégé demeure

      // A2 intact (< 13 mois).
      const a2 = await harness.query(`
        SELECT phone_encrypted, phone_hash FROM tickets
        WHERE id = 'd0080002-0000-4000-8000-00000000db08'
      `);
      expect(a2.rows[0]!.phone_encrypted).not.toBeNull();
      expect(a2.rows[0]!.phone_hash).not.toBeNull();

      // A3 intact (non clos).
      const a3 = await harness.query(`
        SELECT phone_encrypted FROM tickets
        WHERE id = 'd0080003-0000-4000-8000-00000000db08'
      `);
      expect(a3.rows[0]!.phone_encrypted).not.toBeNull();

      // Rejeu idempotent : plus rien à anonymiser (A1 déjà purgé).
      const second = await purgeExpiredPhones(harness.query.bind(harness), { now: NOW });
      expect(second.anonymizedTickets).toBe(0);
    },
    60_000
  );

  it(
    "DB-008: purgeExpiredPhones anonymise les consentements révoqués expirés (horloge contrôlée)",
    async () => {
      const hash1 = hashPhone(PHONE_1);
      const enc1 = encryptPhone(PHONE_1);
      const hash2 = hashPhone(PHONE_2);
      const enc2 = encryptPhone(PHONE_2);

      // Consentement révoqué il y a 14 mois → doit être anonymisé.
      await harness.query(`
        INSERT INTO notification_consents
          (id, bank_id, phone_encrypted, phone_hash, channel, opted_in, revoked_at)
        VALUES (gen_random_uuid(), '${BANK_A}', '${enc1}', '${hash1}', 'SMS', false, '2025-05-01T09:00:00Z')
      `);
      // Consentement révoqué il y a 1 mois → intact.
      await harness.query(`
        INSERT INTO notification_consents
          (id, bank_id, phone_encrypted, phone_hash, channel, opted_in, revoked_at)
        VALUES (gen_random_uuid(), '${BANK_A}', '${enc2}', '${hash2}', 'SMS', false, '2026-06-10T09:00:00Z')
      `);

      const res = await purgeExpiredPhones(harness.query.bind(harness), { now: NOW });
      expect(res.anonymizedConsents).toBeGreaterThanOrEqual(1);

      // Le consentement est du PII PUR (phone_encrypted/phone_hash NOT NULL, sans agrégat
      // à conserver) : la purge l'ÉRADIQUE (DELETE), à la différence du ticket qui, lui,
      // conserve sa ligne agrégée avec phone_* mis à NULL.
      const rows = await harness.query(`
        SELECT phone_hash, revoked_at FROM notification_consents
        WHERE bank_id = '${BANK_A}'
        ORDER BY revoked_at
      `);
      // Il ne reste que le consentement récent (1 mois) — l'expiré (14 mois) est supprimé.
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.phone_hash).toBe(hash2);
      // Le hash du consentement expiré n'existe plus.
      const gone = await harness.query(`
        SELECT count(*)::int AS n FROM notification_consents
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${hash1}'
      `);
      expect(gone.rows[0]!.n).toBe(0);

      // Idempotent.
      const again = await purgeExpiredPhones(harness.query.bind(harness), { now: NOW });
      expect(again.anonymizedConsents).toBe(0);
    },
    60_000
  );

  it(
    "DB-008: purgeExpiredPhones respecte la politique de rétention par banque (1 mois)",
    async () => {
      // Banque A : politique custom 1 mois.
      await harness.query(`
        INSERT INTO retention_policies (id, bank_id, phone_retention_months)
        VALUES (gen_random_uuid(), '${BANK_A}', 1)
      `);
      // Ticket clos il y a 2 mois → purgé (car rétention = 1 mois).
      await insertTicket(harness, "d0080010-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 10,
        status: "DONE",
        phone: PHONE_1,
        issuedAt: "2026-05-01T09:00:00Z",
        closedAt: "2026-05-01T09:30:00Z",
      });

      const res = await purgeExpiredPhones(harness.query.bind(harness), { now: NOW });
      expect(res.anonymizedTickets).toBeGreaterThanOrEqual(1);

      const row = await harness.query(`
        SELECT phone_hash FROM tickets WHERE id = 'd0080010-0000-4000-8000-00000000db08'
      `);
      expect(row.rows[0]!.phone_hash).toBeNull();
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère : purgePhone → toutes occurrences anonymisées, {purged, affectedTickets}
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: purgePhone → toutes occurrences anonymisées, {purged:true,affectedTickets:N} puis {purged:false}",
    async () => {
      // 2 tickets pour PHONE_1 chez BANK_A + 1 consentement.
      await insertTicket(harness, "d0080021-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 21,
        status: "DONE",
        phone: PHONE_1,
        issuedAt: "2026-07-01T09:00:00Z",
        closedAt: "2026-07-01T09:30:00Z",
      });
      await insertTicket(harness, "d0080022-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 22,
        status: "WAITING",
        phone: PHONE_1,
        issuedAt: "2026-07-02T09:00:00Z",
        closedAt: null,
      });
      // 1 ticket pour PHONE_2 → ne doit PAS être touché.
      await insertTicket(harness, "d0080023-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 23,
        status: "DONE",
        phone: PHONE_2,
        issuedAt: "2026-07-03T09:00:00Z",
        closedAt: "2026-07-03T09:30:00Z",
      });
      await harness.query(`
        INSERT INTO notification_consents
          (id, bank_id, phone_encrypted, phone_hash, channel, opted_in, opted_at)
        VALUES (gen_random_uuid(), '${BANK_A}', '${encryptPhone(PHONE_1)}', '${hashPhone(PHONE_1)}', 'SMS', true, now())
      `);

      const result = await purgePhone(harness.query.bind(harness), BANK_A, PHONE_1, {
        actorId: ACTOR_ID,
      });
      expect(result.purged).toBe(true);
      // 2 tickets affectés.
      expect(result.affectedTickets).toBe(2);

      // Toutes les occurrences PHONE_1 anonymisées.
      const remaining = await harness.query(`
        SELECT count(*)::int AS n FROM tickets
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${hashPhone(PHONE_1)}'
      `);
      expect(remaining.rows[0]!.n).toBe(0);

      const consentRemaining = await harness.query(`
        SELECT count(*)::int AS n FROM notification_consents
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${hashPhone(PHONE_1)}'
      `);
      expect(consentRemaining.rows[0]!.n).toBe(0);

      // PHONE_2 intact.
      const phone2 = await harness.query(`
        SELECT count(*)::int AS n FROM tickets
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${hashPhone(PHONE_2)}'
      `);
      expect(phone2.rows[0]!.n).toBe(1);

      // 2e appel → idempotent : rien à purger.
      const second = await purgePhone(harness.query.bind(harness), BANK_A, PHONE_1, {
        actorId: ACTOR_ID,
      });
      expect(second.purged).toBe(false);
      expect(second.affectedTickets).toBe(0);
    },
    60_000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Critère : entrée audit DATA_PURGE créée, sans téléphone en clair
  // ───────────────────────────────────────────────────────────────────────────

  it(
    "DB-008: entrée audit DATA_PURGE créée, sans téléphone en clair (hash tronqué)",
    async () => {
      await insertTicket(harness, "d0080031-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 31,
        status: "DONE",
        phone: PHONE_1,
        issuedAt: "2026-07-01T09:00:00Z",
        closedAt: "2026-07-01T09:30:00Z",
      });

      await purgePhone(harness.query.bind(harness), BANK_A, PHONE_1, { actorId: ACTOR_ID });

      const audit = await harness.query(`
        SELECT action, entity_type, actor_id, diff FROM audit_log
        WHERE bank_id = '${BANK_A}' AND action = 'DATA_PURGE'
      `);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.entity_type).toBe("phone");
      expect(audit.rows[0]!.actor_id).toBe(ACTOR_ID);

      // Le téléphone en clair NE DOIT JAMAIS figurer dans l'entrée d'audit.
      const serialized = JSON.stringify(audit.rows[0]);
      expect(serialized).not.toContain(PHONE_1);
      expect(serialized).not.toContain("+225");
      // Le hash complet ne doit pas figurer non plus : seul un hash TRONQUÉ.
      const fullHash = hashPhone(PHONE_1);
      expect(serialized).not.toContain(fullHash);
      // Un préfixe tronqué du hash (≤ 12 chars) suffit à l'identification.
      const diff = audit.rows[0]!.diff as { phone_hash_prefix?: string } | null;
      expect(diff?.phone_hash_prefix).toBeDefined();
      expect(diff!.phone_hash_prefix!.length).toBeLessThanOrEqual(12);
      expect(fullHash.startsWith(diff!.phone_hash_prefix!)).toBe(true);
    },
    60_000
  );

  it(
    "DB-008: purgeExpiredPhones écrit une entrée audit DATA_PURGE agrégée (sans PII)",
    async () => {
      await insertTicket(harness, "d0080041-0000-4000-8000-00000000db08", {
        bankId: BANK_A,
        number: 41,
        status: "DONE",
        phone: PHONE_1,
        issuedAt: "2025-01-01T09:00:00Z",
        closedAt: "2025-01-01T09:30:00Z",
      });

      await purgeExpiredPhones(harness.query.bind(harness), { now: NOW });

      const audit = await harness.query(`
        SELECT action, entity_type, diff FROM audit_log
        WHERE bank_id = '${BANK_A}' AND action = 'DATA_PURGE'
      `);
      expect(audit.rows.length).toBeGreaterThanOrEqual(1);
      const serialized = JSON.stringify(audit.rows);
      expect(serialized).not.toContain(PHONE_1);
    },
    60_000
  );
});
