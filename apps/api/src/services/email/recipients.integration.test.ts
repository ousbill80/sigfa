/**
 * Tests d'intégration — NOTIF-004 : résolution des destinataires internes par
 * rôle/agence SOUS garde tenant D5 (Testcontainers PG16 réel + RLS applicative).
 *
 * Prouve :
 *  - MANAGER_ALERT → managers/directeurs de l'AGENCE concernée (agency_users) ;
 *  - rapports → rôles d'abonnement au niveau banque ;
 *  - garde tenant D5 : une banque ne résout JAMAIS les utilisateurs d'une autre ;
 *  - inactifs / supprimés / autres rôles exclus ;
 *  - liste vide → NoRecipientError (aucun envoi).
 *
 * Nommage strict : `NOTIF-004: <description>`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { QueryFn } from "@sigfa/database";
import {
  resolveInternalRecipients,
  requireInternalRecipients,
  NoRecipientError,
  MANAGER_ALERT_ROLES,
  REPORT_ROLES,
} from "src/services/email/recipients.js";

let pgContainer: StartedTestContainer;
let db: pg.Client;
let ids: {
  bankA: string;
  bankB: string;
  agencyA1: string;
  agencyA2: string;
};

const queryFn: QueryFn = async (sql: string) => {
  const res = await db.query(sql);
  return { rows: res.rows as Record<string, unknown>[] };
};

async function runMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='role') THEN
        CREATE TYPE role AS ENUM ('SUPER_ADMIN','BANK_ADMIN','AGENCY_DIRECTOR','MANAGER','AGENT','AUDITOR'); END IF;
    END $$;
  `);
  await client.query(
    `CREATE TABLE IF NOT EXISTS banks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);`
  );
  await client.query(
    `CREATE TABLE IF NOT EXISTS agencies (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bank_id UUID NOT NULL REFERENCES banks(id), name TEXT NOT NULL);`
  );
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID REFERENCES banks(id),
      email TEXT NOT NULL UNIQUE,
      role role NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      deleted_at TIMESTAMPTZ
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS agency_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bank_id UUID NOT NULL REFERENCES banks(id),
      agency_id UUID NOT NULL REFERENCES agencies(id),
      user_id UUID NOT NULL REFERENCES users(id)
    );
  `);
  // RLS applicative D5 : un tenant ne voit jamais les users/liens d'un autre.
  for (const table of ["users", "agency_users"]) {
    await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${table};`);
    await client.query(`
      CREATE POLICY tenant_isolation ON ${table}
        USING (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid)
        WITH CHECK (bank_id = nullif(current_setting('app.current_bank_id', true), '')::uuid);
    `);
  }
}

async function insertUser(
  bankId: string,
  email: string,
  role: string,
  opts: { active?: boolean; deleted?: boolean } = {}
): Promise<string> {
  const res = await db.query(
    `INSERT INTO users (bank_id, email, role, is_active, deleted_at)
     VALUES ($1,$2,$3::role,$4,$5) RETURNING id`,
    [bankId, email, role, opts.active ?? true, opts.deleted ? new Date() : null]
  );
  return (res.rows[0] as { id: string }).id;
}

async function assign(bankId: string, agencyId: string, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO agency_users (bank_id, agency_id, user_id) VALUES ($1,$2,$3)`,
    [bankId, agencyId, userId]
  );
}

beforeAll(async () => {
  pgContainer = await new GenericContainer("postgres:16")
    .withEnvironment({
      POSTGRES_USER: "sigfa",
      POSTGRES_PASSWORD: "sigfa_test",
      POSTGRES_DB: "sigfa_test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2)
    )
    .start();
  db = new pg.Client({
    connectionString: `postgresql://sigfa:sigfa_test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/sigfa_test`,
  });
  await db.connect();
  await runMigrations(db);

  const a = await db.query(`INSERT INTO banks (name, slug) VALUES ('A','a') RETURNING id`);
  const b = await db.query(`INSERT INTO banks (name, slug) VALUES ('B','b') RETURNING id`);
  const bankA = (a.rows[0] as { id: string }).id;
  const bankB = (b.rows[0] as { id: string }).id;
  const ag1 = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'A1') RETURNING id`,
    [bankA]
  );
  const ag2 = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'A2') RETURNING id`,
    [bankA]
  );
  ids = {
    bankA,
    bankB,
    agencyA1: (ag1.rows[0] as { id: string }).id,
    agencyA2: (ag2.rows[0] as { id: string }).id,
  };

  // Banque A : managers/directeurs affectés à A1 ; un manager sur A2 ; un agent (exclu) ;
  // un manager inactif et un supprimé (exclus).
  const mgrA1 = await insertUser(bankA, "mgr-a1@banque.example", "MANAGER");
  const dirA1 = await insertUser(bankA, "dir-a1@banque.example", "AGENCY_DIRECTOR");
  const mgrA2 = await insertUser(bankA, "mgr-a2@banque.example", "MANAGER");
  const agentA1 = await insertUser(bankA, "agent-a1@banque.example", "AGENT");
  const inactiveA1 = await insertUser(bankA, "inactive-a1@banque.example", "MANAGER", {
    active: false,
  });
  const deletedA1 = await insertUser(bankA, "deleted-a1@banque.example", "MANAGER", {
    deleted: true,
  });
  await insertUser(bankA, "admin-a@banque.example", "BANK_ADMIN");
  await assign(bankA, ids.agencyA1, mgrA1);
  await assign(bankA, ids.agencyA1, dirA1);
  await assign(bankA, ids.agencyA2, mgrA2);
  await assign(bankA, ids.agencyA1, agentA1);
  await assign(bankA, ids.agencyA1, inactiveA1);
  await assign(bankA, ids.agencyA1, deletedA1);

  // Banque B : un manager sur sa propre agence (ne doit JAMAIS fuir vers A).
  const agB = await db.query(
    `INSERT INTO agencies (bank_id, name) VALUES ($1,'B1') RETURNING id`,
    [bankB]
  );
  const mgrB = await insertUser(bankB, "mgr-b@banque.example", "MANAGER");
  await assign(bankB, (agB.rows[0] as { id: string }).id, mgrB);
}, 180_000);

afterAll(async () => {
  await db?.end();
  await pgContainer?.stop();
}, 40_000);

describe("NOTIF-004 destinataires alerte manager par agence (D5)", () => {
  it("NOTIF-004: alerte manager → managers/directeurs de l'agence concernée (agency_users)", async () => {
    const rec = await resolveInternalRecipients(queryFn, {
      bankId: ids.bankA,
      roles: MANAGER_ALERT_ROLES,
      agencyId: ids.agencyA1,
    });
    // A1 : mgr + dir uniquement (agent/inactif/supprimé exclus, mgr d'A2 exclu).
    expect(rec).toEqual(["dir-a1@banque.example", "mgr-a1@banque.example"]);
  });

  it("NOTIF-004: agence différente → destinataires de cette agence uniquement", async () => {
    const rec = await resolveInternalRecipients(queryFn, {
      bankId: ids.bankA,
      roles: MANAGER_ALERT_ROLES,
      agencyId: ids.agencyA2,
    });
    expect(rec).toEqual(["mgr-a2@banque.example"]);
  });
});

describe("NOTIF-004 destinataires rapport niveau banque (D5)", () => {
  it("NOTIF-004: rapport → rôles d'abonnement de la banque (managers/directeurs/admin)", async () => {
    const rec = await resolveInternalRecipients(queryFn, {
      bankId: ids.bankA,
      roles: REPORT_ROLES,
      agencyId: null,
    });
    // Tous les managers/directeurs actifs + admin de la banque A (agent/inactif/supprimé exclus).
    expect(rec).toContain("admin-a@banque.example");
    expect(rec).toContain("mgr-a1@banque.example");
    expect(rec).toContain("mgr-a2@banque.example");
    expect(rec).toContain("dir-a1@banque.example");
    expect(rec).not.toContain("agent-a1@banque.example");
    expect(rec).not.toContain("inactive-a1@banque.example");
    expect(rec).not.toContain("deleted-a1@banque.example");
  });
});

describe("NOTIF-004 garde tenant D5", () => {
  it("NOTIF-004: banque B ne voit JAMAIS les destinataires de la banque A", async () => {
    const recB = await resolveInternalRecipients(queryFn, {
      bankId: ids.bankB,
      roles: REPORT_ROLES,
      agencyId: null,
    });
    // Seul le manager de B (jamais un email de A).
    expect(recB).toEqual(["mgr-b@banque.example"]);
    for (const email of recB) expect(email).not.toContain("-a");
  });

  it("NOTIF-004: alerte manque de destinataires → NoRecipientError (aucun envoi)", async () => {
    // Banque A, agence A2, rôle inexistant → vide.
    await expect(
      requireInternalRecipients(queryFn, {
        bankId: ids.bankA,
        roles: ["AUDITOR"],
        agencyId: ids.agencyA2,
      })
    ).rejects.toBeInstanceOf(NoRecipientError);
  });

  it("NOTIF-004: liste de rôles vide → aucune requête, résultat vide", async () => {
    const rec = await resolveInternalRecipients(queryFn, {
      bankId: ids.bankA,
      roles: [],
      agencyId: null,
    });
    expect(rec).toEqual([]);
  });
});
