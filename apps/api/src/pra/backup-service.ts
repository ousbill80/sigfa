/**
 * backup-service — orchestration du PRA (SEC-003) : backup chiffré + restauration.
 *
 * Chaîne de backup :
 *   dump PostgreSQL → chiffrement AES-256-GCM (SSE app) → checksum SHA-256 →
 *   push stockage objet (interface `BackupStorage`) → VÉRIFICATION post-push
 *   (objet présent + taille > 0 + checksum concordant). Le silence n'est pas un
 *   succès : une poussée non confirmée émet une ALERTE (canal ops injecté) et
 *   propage l'échec.
 *
 * Chaîne de restauration :
 *   sélection du dernier backup valide → get objet → re-vérif checksum →
 *   déchiffrement → restore PostgreSQL. Bascule vers l'avant-dernier point valide
 *   si le plus récent est corrompu/absent (RPO dégradé documenté).
 *
 * Le DUMP et le RESTORE réels sont INJECTÉS (`DumpFn`/`RestoreFn`) : les tests
 * unitaires passent un fake déterministe ; le game day CI injecte un adaptateur
 * qui exécute `pg_dump`/`pg_restore` DANS le conteneur PostgreSQL (aucun binaire
 * client requis sur le runner, aucune I/O réseau réelle).
 *
 * @module
 */

import {
  checksum,
  decryptBackup,
  encryptBackup,
  loadBackupKey,
} from "src/pra/backup-cipher.js";
import {
  cadencePrefix,
  getRetentionPolicy,
  type BackupCadence,
  type RetentionPolicy,
} from "src/pra/backup-config.js";
import {
  type BackupObjectMeta,
  type BackupStorage,
} from "src/pra/backup-storage.js";

/** Produit un dump binaire de la base. Injecté (fake en test, exec conteneur en CI). */
export type DumpFn = () => Promise<Buffer>;

/** Restaure la base à partir d'un dump binaire en clair. Injecté. */
export type RestoreFn = (plainDump: Buffer) => Promise<void>;

/** Émet une alerte ops (échec de backup). Injecté (no-op/collecteur en test). */
export type AlertFn = (message: string, context: Record<string, unknown>) => void;

/** Résultat d'un backup réussi (ce qui a été confirmé côté stockage). */
export interface BackupResult {
  /** Clé objet du backup dans le bucket. */
  key: string;
  /** Cadence du backup. */
  cadence: BackupCadence;
  /** Taille de l'enveloppe chiffrée (octets). */
  size: number;
  /** Checksum SHA-256 de l'enveloppe chiffrée. */
  checksum: string;
  /** Instant de création (ISO 8601) — sert au calcul RPO. */
  createdAt: string;
}

/** Erreur d'échec de poussée/vérification de backup (déclenche une alerte). */
export class BackupPushError extends Error {
  /** @param key - Clé objet concernée @param reason - Cause lisible */
  constructor(
    public readonly key: string,
    reason: string
  ) {
    super(`Poussée de backup non confirmée (${key}) : ${reason}`);
    this.name = "BackupPushError";
  }
}

/** Erreur : aucun backup valide restaurable trouvé. */
export class NoValidBackupError extends Error {
  /** @param prefix - Préfixe interrogé */
  constructor(prefix: string) {
    super(`Aucun backup valide restaurable sous ${prefix}.`);
    this.name = "NoValidBackupError";
  }
}

/** Dépendances injectées du service de backup. */
export interface BackupServiceDeps {
  /** Stockage objet (mock en CI, R2 en prod). */
  storage: BackupStorage;
  /** Producteur de dump PostgreSQL. */
  dump: DumpFn;
  /** Restaurateur PostgreSQL. */
  restore: RestoreFn;
  /** Canal d'alerte ops (défaut : no-op). */
  alert?: AlertFn;
  /** Horloge injectable (défaut : horloge système). */
  clock?: () => Date;
  /** Clé de chiffrement (défaut : lue depuis l'environnement). */
  key?: Buffer;
  /** Politique de rétention (défaut : lue depuis l'environnement). */
  retention?: RetentionPolicy;
}

/**
 * Service PRA : backup chiffré vérifié, restauration testée, rétention.
 */
export class BackupService {
  private readonly storage: BackupStorage;
  private readonly dump: DumpFn;
  private readonly restore: RestoreFn;
  private readonly alert: AlertFn;
  private readonly clock: () => Date;
  private readonly key: Buffer;
  private readonly retention: RetentionPolicy;

  /** @param deps - Dépendances injectées */
  constructor(deps: BackupServiceDeps) {
    this.storage = deps.storage;
    this.dump = deps.dump;
    this.restore = deps.restore;
    this.alert = deps.alert ?? (() => {});
    this.clock = deps.clock ?? (() => new Date());
    this.key = deps.key ?? loadBackupKey();
    this.retention = deps.retention ?? getRetentionPolicy();
  }

  /**
   * Produit, chiffre, pousse ET vérifie un backup. Émet une alerte + rejette si
   * la poussée n'est pas confirmée (objet absent, taille 0, checksum divergent).
   *
   * @param cadence - Cadence de classement (`hourly` par défaut)
   * @returns Métadonnées confirmées du backup
   * @throws {BackupPushError} si la poussée n'est pas confirmée
   */
  async createBackup(cadence: BackupCadence = "hourly"): Promise<BackupResult> {
    const now = this.clock();
    const plain = await this.dump();
    const envelope = encryptBackup(plain, this.key);
    const sum = checksum(envelope);
    const key = this.buildKey(cadence, now);

    let head: BackupObjectMeta | null;
    try {
      await this.storage.put(key, envelope, sum);
      head = await this.storage.head(key);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      this.emitPushAlert(key, reason);
      throw new BackupPushError(key, reason);
    }

    // Le silence n'est pas un succès : on VÉRIFIE la présence réelle de l'objet.
    if (!head) {
      this.emitPushAlert(key, "objet absent après put");
      throw new BackupPushError(key, "objet absent après put");
    }
    if (head.size <= 0) {
      this.emitPushAlert(key, "taille nulle");
      throw new BackupPushError(key, "taille nulle");
    }
    if (head.checksum !== sum) {
      this.emitPushAlert(key, "checksum divergent");
      throw new BackupPushError(key, "checksum divergent");
    }

    return {
      key,
      cadence,
      size: head.size,
      checksum: head.checksum,
      createdAt: head.createdAt,
    };
  }

  /**
   * Restaure la base depuis le dernier backup valide d'une cadence.
   *
   * Sélectionne le plus récent ; si son checksum ne concorde pas (corruption),
   * bascule vers le point valide précédent (RPO dégradé) et le signale.
   *
   * @param cadence - Cadence à restaurer (`hourly` par défaut)
   * @returns Métadonnées du backup effectivement restauré + `degraded`
   * @throws {NoValidBackupError} si aucun point valide n'existe
   */
  async restoreLatest(
    cadence: BackupCadence = "hourly"
  ): Promise<{ restored: BackupObjectMeta; degraded: boolean }> {
    const prefix = cadencePrefix(cadence);
    const metas = await this.storage.list(prefix);
    // Plus récent d'abord.
    const ordered = [...metas].reverse();

    let degraded = false;
    for (const meta of ordered) {
      const envelope = await this.storage.get(meta.key);
      if (checksum(envelope) !== meta.checksum) {
        // Point corrompu → on tente le suivant (bascule RPO dégradé).
        degraded = true;
        this.alert("Backup corrompu ignoré lors de la restauration", {
          key: meta.key,
          reason: "checksum divergent",
        });
        continue;
      }
      const plain = decryptBackup(envelope, this.key);
      await this.restore(plain);
      return { restored: meta, degraded };
    }
    throw new NoValidBackupError(prefix);
  }

  /**
   * Applique la politique de rétention : supprime les backups horaires plus
   * vieux que `hourlyRetentionHours` et les quotidiens plus vieux que
   * `dailyRetentionDays`. Retourne les clés supprimées.
   *
   * @returns Liste des clés effectivement supprimées
   */
  async pruneExpired(): Promise<string[]> {
    const now = this.clock().getTime();
    const removed: string[] = [];

    const hourlyCutoff = now - this.retention.hourlyRetentionHours * 3_600_000;
    removed.push(...(await this.pruneBelow("hourly", hourlyCutoff)));

    const dailyCutoff = now - this.retention.dailyRetentionDays * 86_400_000;
    removed.push(...(await this.pruneBelow("daily", dailyCutoff)));

    return removed;
  }

  /** Supprime les objets d'une cadence antérieurs au `cutoff` (ms epoch). */
  private async pruneBelow(cadence: BackupCadence, cutoff: number): Promise<string[]> {
    const metas = await this.storage.list(cadencePrefix(cadence));
    const removed: string[] = [];
    for (const meta of metas) {
      if (new Date(meta.createdAt).getTime() < cutoff) {
        await this.storage.delete(meta.key);
        removed.push(meta.key);
      }
    }
    return removed;
  }

  /** Construit une clé objet horodatée, triable lexicographiquement. */
  private buildKey(cadence: BackupCadence, now: Date): string {
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    return `${cadencePrefix(cadence)}sigfa-${stamp}.dump.enc`;
  }

  /** Émet une alerte de poussée échouée (canal ops). */
  private emitPushAlert(key: string, reason: string): void {
    this.alert("Poussée de backup PRA non confirmée", { key, reason });
  }
}
