/**
 * MockBackupStorage — adaptateur `BackupStorage` 100 % en mémoire (SEC-003).
 *
 * Émule un bucket objet S3-compatible sans AUCUNE I/O réseau : c'est l'adaptateur
 * utilisé par le « game day » CI et les tests unitaires. Le contenu binaire est
 * copié à l'écriture ET à la lecture (défense contre la mutation externe du
 * Buffer), pour que le stockage se comporte comme un vrai objet immuable.
 *
 * En prod, cet adaptateur est remplacé par un adaptateur R2 (SigV4) — hors CI,
 * GATED infra (cf. RUNBOOK).
 *
 * @module
 */

import {
  BackupObjectNotFoundError,
  type BackupObjectMeta,
  type BackupStorage,
} from "src/pra/backup-storage.js";

/** Entrée interne : métadonnées + copie défensive du contenu. */
interface StoredObject {
  meta: BackupObjectMeta;
  body: Buffer;
}

/**
 * Implémentation en mémoire de `BackupStorage` pour tests et game day CI.
 *
 * L'horloge est injectable pour des `createdAt` déterministes dans les tests de
 * rétention (backups « vieux » de N heures sans attendre réellement).
 */
export class MockBackupStorage implements BackupStorage {
  /** Objets indexés par clé. */
  private readonly objects = new Map<string, StoredObject>();
  /** Horloge injectable (défaut : horloge système). */
  private readonly clock: () => Date;

  /** @param clock - Fournisseur d'instant (défaut `() => new Date()`) */
  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  /** @inheritdoc */
  put(key: string, body: Buffer, checksum: string): Promise<BackupObjectMeta> {
    const copy = Buffer.from(body);
    const meta: BackupObjectMeta = {
      key,
      size: copy.byteLength,
      checksum,
      createdAt: this.clock().toISOString(),
    };
    this.objects.set(key, { meta, body: copy });
    return Promise.resolve(meta);
  }

  /** @inheritdoc */
  get(key: string): Promise<Buffer> {
    const entry = this.objects.get(key);
    if (!entry) return Promise.reject(new BackupObjectNotFoundError(key));
    return Promise.resolve(Buffer.from(entry.body));
  }

  /** @inheritdoc */
  head(key: string): Promise<BackupObjectMeta | null> {
    const entry = this.objects.get(key);
    return Promise.resolve(entry ? { ...entry.meta } : null);
  }

  /** @inheritdoc */
  list(prefix: string): Promise<BackupObjectMeta[]> {
    const metas = [...this.objects.values()]
      .map((e) => ({ ...e.meta }))
      .filter((m) => m.key.startsWith(prefix))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return Promise.resolve(metas);
  }

  /** @inheritdoc */
  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Nombre d'objets stockés (introspection de test uniquement). */
  get size(): number {
    return this.objects.size;
  }
}
