/**
 * IA-001 — Matérialisation légère du feature-set (upsert idempotent, isolation tenant).
 *
 * ## Pourquoi une matérialisation EN MÉMOIRE ?
 * Aucune table `ai_features` dédiée n'existe dans `packages/database/src/schema`
 * (zone parallèle — NON modifiée par cette story, cf. consigne). Le pipeline
 * matérialise donc les features dans un `InMemoryFeatureStore` qui reproduit le
 * contrat d'upsert idempotent et d'isolation `bankId` attendu de la future table.
 *
 * → **Dépendance DB à créer (hors périmètre) : table `ai_features`** clé unique
 *   `(bank_id, agency_id, service_id, date, hour_bucket, feature_set_version)`,
 *   politique RLS `tenant_isolation`, rétention DB-007. Voir rapport de sortie.
 *
 * ## Idempotence
 * `upsertMany` réécrit chaque enregistrement à sa clé canonique — rejouer la même
 * fenêtre produit exactement les mêmes lignes, jamais de doublon.
 *
 * ## Isolation tenant STRICTE
 * Toute lecture (`getByBank`, `count`) exige un `bankId` et ne renvoie JAMAIS de
 * ligne d'un autre tenant. Un upsert ne peut pas écrire hors du `bankId` porté par
 * chaque record (la clé inclut `bankId`).
 *
 * @module
 */

import { canonicalKey, sortByCanonicalKey, type FeatureRecord } from "src/ai/feature-engine.js";

/** Store de matérialisation des features (contrat minimal). */
export interface FeatureStore {
  /**
   * Insère/met à jour un lot de features de façon idempotente (upsert par clé
   * canonique). Retourne le nombre de clés distinctes après application.
   */
  upsertMany(records: readonly FeatureRecord[]): number;
  /** Lit toutes les features d'un tenant (triées par clé canonique). */
  getByBank(bankId: string): FeatureRecord[];
  /** Nombre de features matérialisées pour un tenant. */
  count(bankId: string): number;
  /** Vide entièrement le store (fixtures/tests). */
  clear(): void;
}

/** Matérialisation en mémoire — substitut testable de la future table `ai_features`. */
export class InMemoryFeatureStore implements FeatureStore {
  /** clé canonique → record. Un seul record par clé (idempotence). */
  private readonly byKey = new Map<string, FeatureRecord>();

  upsertMany(records: readonly FeatureRecord[]): number {
    for (const r of records) {
      this.byKey.set(canonicalKey(r), r);
    }
    return this.byKey.size;
  }

  getByBank(bankId: string): FeatureRecord[] {
    const rows: FeatureRecord[] = [];
    for (const r of this.byKey.values()) {
      if (r.bankId === bankId) rows.push(r);
    }
    return sortByCanonicalKey(rows);
  }

  count(bankId: string): number {
    let n = 0;
    for (const r of this.byKey.values()) {
      if (r.bankId === bankId) n += 1;
    }
    return n;
  }

  clear(): void {
    this.byKey.clear();
  }
}
