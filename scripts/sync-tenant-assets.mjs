#!/usr/bin/env node
/**
 * sync-tenant-assets.mjs — Synchronise les assets de branding des tenants
 * (`assets/tenants/<slug>/…`) vers les dossiers statiques des apps Next
 * (`apps/web/public/tenants/<slug>/…`, `apps/kiosk/public/tenants/<slug>/…`).
 *
 * Les apps servent ensuite ces fichiers sous `/tenants/<slug>/…` — URL qui
 * vit UNIQUEMENT dans la config de seed du tenant (ex.
 * `packages/database/src/seed/tenants/bicici.ts` → `logoUrl`) et dans les env
 * vars de provisionnement (`NEXT_PUBLIC_BANK_LOGO_URL`). Jamais en dur dans
 * les composants.
 *
 * Usage : `node scripts/sync-tenant-assets.mjs` (idempotent, écrase la copie).
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "assets", "tenants");

/** Apps Next servant des assets statiques de tenants. */
const TARGET_APPS = ["apps/web", "apps/kiosk"];

if (!existsSync(SOURCE_DIR)) {
  console.error(`[sync-tenant-assets] Source introuvable : ${SOURCE_DIR}`);
  process.exit(1);
}

const tenants = readdirSync(SOURCE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (tenants.length === 0) {
  console.log("[sync-tenant-assets] Aucun tenant sous assets/tenants/ — rien à faire.");
  process.exit(0);
}

let copies = 0;
for (const app of TARGET_APPS) {
  const publicDir = join(ROOT, app, "public");
  if (!existsSync(publicDir)) {
    console.warn(`[sync-tenant-assets] ${app}/public absent — app ignorée.`);
    continue;
  }
  for (const tenant of tenants) {
    const src = join(SOURCE_DIR, tenant);
    const dest = join(publicDir, "tenants", tenant);
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
    copies += 1;
    console.log(`[sync-tenant-assets] ${tenant} → ${app}/public/tenants/${tenant}`);
  }
}

console.log(`[sync-tenant-assets] Terminé (${copies} synchronisation(s)).`);
