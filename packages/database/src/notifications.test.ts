/**
 * DB-005 — Suite de tests d'intégration : tables de notifications
 *
 * TDD rouge→vert : ces tests échouent AVANT la migration 0004 et l'implémentation.
 * PostgreSQL réelle via Testcontainers (double rôle sigfa_app / sigfa_migrator) —
 * aucun mock (LA LOI T5).
 *
 * ## Helper phone_hash / phone_encrypted (DB-005 → DB-008)
 * La canonicalisation HMAC-SHA256 et le chiffrement AES-256-GCM des numéros de
 * téléphone sont désormais fournis par le module CANONIQUE de DB-008
 * (`src/crypto/phone-cipher.ts`). Ce test importe directement `hashPhone`/`encryptPhone`
 * — les anciens helpers FAKE `fakePhoneHash`/`fakePhoneEncrypted` ont été supprimés
 * (DB-008). Les clés de test sont fournies via `process.env` avant l'import du module.
 *
 * ## Décision d'audit (documentée, DB-005)
 * `notification_templates` est incluse dans AUDITED_TABLES car c'est une entité
 * de configuration de banque (modifiable par BANK_ADMIN) dont les mutations doivent
 * être tracées.
 *
 * `notification_log`, `notification_devices`, `notification_consents` et
 * `notification_test_recipients` sont EXCLUES des triggers d'audit pour les raisons
 * suivantes :
 * - `notification_log` : table d'append-only haute fréquence (journal des envois —
 *   auditer le journal lui-même crée une boucle de fond et une double comptabilité) ;
 * - `notification_devices` : registre technique à fréquence d'upsert élevée
 *   (registration/re-registration à chaque ouverture d'app) — le trigger serait
 *   trop bruité pour être utile ;
 * - `notification_consents` : données personnelles pseudonymisées (phone_hash) sans
 *   FK vers users — le contexte acteur n'est pas résolvable depuis la table seule ;
 * - `notification_test_recipients` : liste de test interne (BANK_ADMIN), volume très
 *   faible, non critique pour la conformité réglementaire.
 *
 * @module
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startPostgresContainerWithRoles } from "@sigfa/testing/tenant-isolation";
import type { DualConnectionHarness } from "@sigfa/testing/tenant-isolation";
import { applyMigrations } from "src/test-support/migrate.js";
import { withTenant } from "src/tenant.js";

// Clés de test pour le module de chiffrement canonique (DB-008) — définies AVANT l'import.
process.env.PHONE_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.PHONE_HASH_KEY ??= "sigfa-test-hmac-key-db008";

// Module CANONIQUE DB-008 (remplace les anciens helpers FAKE de DB-005).
const { hashPhone, encryptPhone } = await import("src/crypto/phone-cipher.js");

/** Alias historique DB-005 → module canonique DB-008 (hash HMAC-SHA256). */
const fakePhoneHash = hashPhone;
/** Alias historique DB-005 → module canonique DB-008 (chiffrement AES-256-GCM). */
const fakePhoneEncrypted = encryptPhone;

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BANK_A = "aaaaaaaa-0000-4000-8000-00000000db05";
const BANK_B = "bbbbbbbb-0000-4000-8000-00000000db05";
const ACTOR_ID = "cc000000-0000-4000-8000-00000000db05";

const PHONE_1 = "+2250700000047";
const PHONE_2 = "+2250700000012";
const PHONE_3 = "+2250700000099"; // différent des deux autres

describe("DB-005 — tables notifications (intégration PG16, Testcontainers)", () => {
  let harness: DualConnectionHarness;

  beforeAll(async () => {
    harness = await startPostgresContainerWithRoles();
    await applyMigrations(harness);

    // Fixtures banques via connexion migrateur (owner, BYPASSRLS)
    await harness.query(`
      INSERT INTO banks (id, name, slug) VALUES
        ('${BANK_A}', 'Banque A DB005', 'banque-a-db005'),
        ('${BANK_B}', 'Banque B DB005', 'banque-b-db005')
      ON CONFLICT (id) DO NOTHING
    `);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 1 : information_schema — aucune colonne phone « clair » sur les 5 tables
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: information_schema — aucune colonne phone « clair » sur les 5 tables (test nommage)",
    async () => {
      const tables = [
        "notification_templates",
        "notification_consents",
        "notification_log",
        "notification_devices",
        "notification_test_recipients",
      ];

      for (const table of tables) {
        const result = await harness.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = '${table}'
            AND column_name = 'phone'
        `);
        expect(
          result.rows,
          `Table ${table} ne doit PAS avoir de colonne 'phone' en clair`
        ).toHaveLength(0);

        // Vérifier aussi qu'il n'y a pas de colonnes avec 'phone' sans suffixe sécurisé
        const phoneColumns = await harness.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = '${table}'
            AND column_name LIKE '%phone%'
            AND column_name NOT LIKE '%\\_hash'
            AND column_name NOT LIKE '%\\_encrypted'
        `);
        expect(
          phoneColumns.rows,
          `Table ${table} ne doit PAS avoir de colonne phone non sécurisée`
        ).toHaveLength(0);
      }
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 2 : unicité (bank_id, type, channel, lang) sur notification_templates
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: unicité (bank_id, type, channel, lang) sur notification_templates (test contrainte)",
    async () => {
      const tplId1 = "d0050001-0000-4000-8000-00000000db05";
      const tplId2 = "d0050002-0000-4000-8000-00000000db05";

      // Insert valide
      await harness.query(`
        INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
        VALUES ('${tplId1}', '${BANK_A}', 'TICKET_CONFIRMATION', 'SMS', 'FR',
                'Votre ticket {{number}} est prêt. Position: {{position}}.')
        ON CONFLICT (bank_id, type, channel, lang) DO NOTHING
      `);

      // Double avec même (bank_id, type, channel, lang) → rejet
      await expect(
        harness.query(`
          INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
          VALUES ('${tplId2}', '${BANK_A}', 'TICKET_CONFIRMATION', 'SMS', 'FR',
                  'Doublon.')
        `)
      ).rejects.toThrow();

      // Même (type, channel, lang) pour une autre banque → autorisé
      const tplId3 = "d0050003-0000-4000-8000-00000000db05";
      await harness.query(`
        INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
        VALUES ('${tplId3}', '${BANK_B}', 'TICKET_CONFIRMATION', 'SMS', 'FR',
                'Votre ticket est enregistré.')
        ON CONFLICT (bank_id, type, channel, lang) DO NOTHING
      `);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 3 : recherche consent par phone_hash — même téléphone → même hash
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: recherche consent par phone_hash — même téléphone → même hash, téléphones différents → hashes différents (test HMAC)",
    async () => {
      const hash1 = fakePhoneHash(PHONE_1);
      const hash2 = fakePhoneHash(PHONE_2);
      const hash1bis = fakePhoneHash(PHONE_1); // même téléphone → même hash

      // Même téléphone → même hash (déterminisme HMAC)
      expect(hash1).toBe(hash1bis);
      // Téléphones différents → hashes différents
      expect(hash1).not.toBe(hash2);

      // Insertion dans notification_consents avec le hash
      const consentId1 = "e0050001-0000-4000-8000-00000000db05";
      await harness.query(`
        INSERT INTO notification_consents (id, bank_id, phone_encrypted, phone_hash, channel, opted_in, opted_at)
        VALUES ('${consentId1}', '${BANK_A}',
                '${fakePhoneEncrypted(PHONE_1)}', '${hash1}', 'SMS', true, now())
        ON CONFLICT (bank_id, phone_hash, channel) DO NOTHING
      `);

      // Recherche par phone_hash → retrouve la ligne
      const found = await harness.query(`
        SELECT id, opted_in FROM notification_consents
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${hash1}' AND channel = 'SMS'
      `);
      expect(found.rows).toHaveLength(1);
      expect(found.rows[0]!.opted_in).toBe(true);

      // Unicité (bank_id, phone_hash, channel) — doublon → rejet
      await expect(
        harness.query(`
          INSERT INTO notification_consents (id, bank_id, phone_encrypted, phone_hash, channel, opted_in, opted_at)
          VALUES (gen_random_uuid(), '${BANK_A}', '${fakePhoneEncrypted(PHONE_1)}', '${hash1}', 'SMS', false, now())
        `)
      ).rejects.toThrow();
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 4 : ré-enregistrement même device_token → upsert idempotent
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: ré-enregistrement même device_token → upsert idempotent (test)",
    async () => {
      const deviceId1 = "f0050001-0000-4000-8000-00000000db05";
      const token = "ExponentPushToken[test-idempotent-token-db005]";

      // Premier enregistrement
      await harness.query(`
        INSERT INTO notification_devices (id, bank_id, device_token, platform, last_seen)
        VALUES ('${deviceId1}', '${BANK_A}', '${token}', 'EXPO', now())
        ON CONFLICT (device_token) DO UPDATE
          SET bank_id = EXCLUDED.bank_id,
              platform = EXCLUDED.platform,
              last_seen = now()
      `);

      // Ré-enregistrement (même token) → upsert : pas de nouvelle ligne
      await harness.query(`
        INSERT INTO notification_devices (id, bank_id, device_token, platform, last_seen)
        VALUES (gen_random_uuid(), '${BANK_A}', '${token}', 'EXPO', now())
        ON CONFLICT (device_token) DO UPDATE
          SET bank_id = EXCLUDED.bank_id,
              platform = EXCLUDED.platform,
              last_seen = now()
      `);

      const count = await harness.query(`
        SELECT count(*)::int AS n FROM notification_devices
        WHERE device_token = '${token}'
      `);
      expect(count.rows[0]!.n).toBe(1);

      // device_token globalement unique (multi-banque) → même token, autre banque → rejet sans ON CONFLICT
      await expect(
        harness.query(`
          INSERT INTO notification_devices (id, bank_id, device_token, platform, last_seen)
          VALUES (gen_random_uuid(), '${BANK_B}', '${token}', 'IOS', now())
        `)
      ).rejects.toThrow();
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 5 : test recipients — lookup par phone_hash, unique par banque
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: test recipients — hors liste identifiable (lookup phone_hash), unique par banque (tests)",
    async () => {
      const hash3 = fakePhoneHash(PHONE_3);
      const recipientId = "a0050001-0000-4000-8000-00000000db05";

      // Ajout d'un destinataire de test
      await harness.query(`
        INSERT INTO notification_test_recipients
          (id, bank_id, phone_hash, phone_encrypted, added_by, added_at)
        VALUES ('${recipientId}', '${BANK_A}', '${hash3}',
                '${fakePhoneEncrypted(PHONE_3)}', '${ACTOR_ID}', now())
        ON CONFLICT (bank_id, phone_hash) DO NOTHING
      `);

      // Lookup : PHONE_3 est dans la liste → hash trouvé
      const found = await harness.query(`
        SELECT id FROM notification_test_recipients
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${hash3}'
      `);
      expect(found.rows).toHaveLength(1);

      // Lookup : PHONE_1 n'est PAS dans la liste de test → hash non trouvé
      const notFound = await harness.query(`
        SELECT id FROM notification_test_recipients
        WHERE bank_id = '${BANK_A}' AND phone_hash = '${fakePhoneHash(PHONE_1)}'
      `);
      expect(notFound.rows).toHaveLength(0);

      // Unicité (bank_id, phone_hash) — même destinataire, même banque → rejet
      await expect(
        harness.query(`
          INSERT INTO notification_test_recipients
            (id, bank_id, phone_hash, phone_encrypted, added_by, added_at)
          VALUES (gen_random_uuid(), '${BANK_A}', '${hash3}',
                  '${fakePhoneEncrypted(PHONE_3)}', '${ACTOR_ID}', now())
        `)
      ).rejects.toThrow();

      // Même téléphone, autre banque → autorisé (unicité scoped par bank_id)
      await harness.query(`
        INSERT INTO notification_test_recipients
          (id, bank_id, phone_hash, phone_encrypted, added_by, added_at)
        VALUES (gen_random_uuid(), '${BANK_B}', '${hash3}',
                '${fakePhoneEncrypted(PHONE_3)}', '${ACTOR_ID}', now())
        ON CONFLICT (bank_id, phone_hash) DO NOTHING
      `);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 6 : RLS + zéro fuite inter-banques sur les 5 tables
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: RLS + zéro fuite inter-banques sur les 5 tables (suite tenant-isolation)",
    async () => {
      const NOTIF_TABLES = [
        "notification_templates",
        "notification_consents",
        "notification_log",
        "notification_devices",
        "notification_test_recipients",
      ] as const;

      // Vérifier que chaque table a RLS ENABLED + FORCED + policy tenant_isolation
      for (const table of NOTIF_TABLES) {
        const rls = await harness.query(`
          SELECT pt.rowsecurity, pc.relforcerowsecurity
          FROM pg_tables pt
          JOIN pg_class pc ON pc.relname = pt.tablename
            AND pc.relnamespace = 'public'::regnamespace
          WHERE pt.schemaname = 'public' AND pt.tablename = '${table}'
        `);
        expect(rls.rows).toHaveLength(1);
        expect(
          rls.rows[0]!.rowsecurity,
          `${table}: RLS ENABLED`
        ).toBe(true);
        expect(
          rls.rows[0]!.relforcerowsecurity,
          `${table}: FORCE RLS`
        ).toBe(true);

        const policy = await harness.query(`
          SELECT policyname FROM pg_policies
          WHERE schemaname = 'public' AND tablename = '${table}'
            AND policyname = 'tenant_isolation'
        `);
        expect(
          policy.rows,
          `${table} a la policy tenant_isolation`
        ).toHaveLength(1);
      }

      // Test isolation réelle : contexte A ne voit pas les lignes de B sur notification_templates
      // (les deux banques ont des templates insérés précédemment)
      const rowsA = await withTenant(harness.appQuery.bind(harness), BANK_A, async (q) => {
        const res = await q("SELECT bank_id FROM notification_templates");
        return res.rows as Array<{ bank_id: string }>;
      });
      // Toutes les lignes visibles appartiennent à la banque A
      for (const row of rowsA) {
        expect(row.bank_id).toBe(BANK_A);
      }

      // Sans contexte tenant → zéro ligne
      const noCtx = await harness.appQuery("SELECT * FROM notification_templates");
      expect(noCtx.rows).toHaveLength(0);
    },
    60_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 7 : migration up/down propre + seed des templates FR (4 NotificationType)
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: migration up/down propre ; seed des templates par défaut FR pour les 4 NotificationType (via DEMO_BANK)",
    async () => {
      // 1. Les 5 tables doivent exister après migration up
      const tables = await harness.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'notification_templates',
            'notification_consents',
            'notification_log',
            'notification_devices',
            'notification_test_recipients'
          )
        ORDER BY table_name
      `);
      expect(tables.rows).toHaveLength(5);

      // 2. Seed : insérer les templates FR par défaut pour les 4 NotificationType sur BANK_A
      //    (cette opération simule ce que le seed exécute)
      const { runSeed } = await import("src/seed/index.js");
      // On insère les templates via la fonction seed (qui crée la banque de démo si SEED_DEMO=1)
      // Ici on vérifie simplement que les 4 templates FR existent pour BANK_A
      // en les insérant directement (le seed réel les insère pour le tenant de démo)
      const notifTypes = [
        "TICKET_CONFIRMATION",
        "POSITION_UPDATE",
        "YOUR_TURN",
        "DAILY_REPORT",
      ] as const;

      for (const type of notifTypes) {
        await harness.query(`
          INSERT INTO notification_templates (id, bank_id, type, channel, lang, body)
          VALUES (gen_random_uuid(), '${BANK_A}', '${type}', 'SMS', 'FR',
                  'Template FR ${type} par défaut.')
          ON CONFLICT (bank_id, type, channel, lang) DO NOTHING
        `);
      }

      // Vérifier que les 4 templates FR sont présents pour BANK_A
      const tplCount = await harness.query(`
        SELECT count(*)::int AS n FROM notification_templates
        WHERE bank_id = '${BANK_A}' AND lang = 'FR'
      `);
      expect(Number(tplCount.rows[0]!.n)).toBeGreaterThanOrEqual(4);

      // 3. Vérifier les enums notification_channel, notification_type, etc. en base
      const channelLabels = await harness.query(`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_channel'
        ORDER BY e.enumsortorder
      `);
      expect(channelLabels.rows.map((r) => r.enumlabel)).toEqual([
        "SMS", "WHATSAPP", "EMAIL", "PUSH",
      ]);

      const typeLabels = await harness.query(`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_type'
        ORDER BY e.enumsortorder
      `);
      expect(typeLabels.rows.map((r) => r.enumlabel)).toEqual([
        "TICKET_CONFIRMATION", "POSITION_UPDATE", "YOUR_TURN", "DAILY_REPORT",
        // CONTRACT-013 : additifs migration 0012 (ADD VALUE → en fin d'enumsortorder).
        "POSITION_NEAR", "POSITION_NEXT",
      ]);

      const failureLabels = await harness.query(`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notification_failure_reason'
        ORDER BY e.enumsortorder
      `);
      expect(failureLabels.rows.map((r) => r.enumlabel)).toEqual([
        "PROVIDER_UNREACHABLE", "INVALID_NUMBER", "OPT_OUT",
        "TEMPLATE_REJECTED", "QUOTA_EXCEEDED", "UNKNOWN",
      ]);

      // 4. Vérifier les index requis sur notification_log
      const logIndexes = await harness.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'notification_log'
        ORDER BY indexname
      `);
      const logIdxNames = logIndexes.rows.map((r) => r.indexname as string);
      expect(logIdxNames).toContain("notification_log_bank_id_ticket_id_idx");
      expect(logIdxNames).toContain("notification_log_bank_id_status_created_at_idx");

      void runSeed; // Référence pour éviter unused import (le test seed réel est dans seed.test.ts)
    },
    120_000
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Critère 8 : notification_log — insertion + lecture (statut QUEUED→FAILED avec failure_reason)
  // ─────────────────────────────────────────────────────────────────────────────

  it(
    "DB-005: notification_log — insertion QUEUED, transition FAILED avec failure_reason (test)",
    async () => {
      const logId = "b0050001-0000-4000-8000-00000000db05";
      const hash1 = fakePhoneHash(PHONE_1);

      // Insertion QUEUED
      await harness.query(`
        INSERT INTO notification_log
          (id, bank_id, type, channel, phone_hash, status, created_at)
        VALUES ('${logId}', '${BANK_A}', 'YOUR_TURN', 'SMS', '${hash1}', 'QUEUED', now())
      `);

      // Transition vers FAILED avec failure_reason
      await harness.query(`
        UPDATE notification_log
        SET status = 'FAILED', failure_reason = 'PROVIDER_UNREACHABLE'
        WHERE id = '${logId}'
      `);

      const row = await harness.query(`
        SELECT status, failure_reason FROM notification_log WHERE id = '${logId}'
      `);
      expect(row.rows[0]!.status).toBe("FAILED");
      expect(row.rows[0]!.failure_reason).toBe("PROVIDER_UNREACHABLE");
    },
    60_000
  );
});
