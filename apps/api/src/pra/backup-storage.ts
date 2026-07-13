/**
 * BackupStorage — interface de stockage objet S3-compatible pour le PRA (SEC-003).
 *
 * Le PRA pousse ses dumps chiffrés vers un stockage objet (Cloudflare R2 en prod,
 * décision QO-2 : R2 déjà en place pour les logos, S3-compatible). Le contrat de
 * stockage est ABSTRAIT derrière cette interface afin que :
 *  - le service de backup ne dépende JAMAIS d'un SDK cloud concret ;
 *  - le « game day » de restauration tourne EN CI sur un adaptateur MOCK
 *    100 % en mémoire, SANS aucune dépendance réseau réelle (R2/S3/MinIO).
 *
 * L'adaptateur réel R2 (SigV4 déjà maîtrisé, cf. `lib/r2-presign.ts`) est un
 * artefact de déploiement GATED infra (cf. `ops/pra/RUNBOOK.md`) — hors CI.
 *
 * @module
 */

/** Métadonnées d'un objet stocké (sans son contenu). */
export interface BackupObjectMeta {
  /** Clé objet (chemin logique dans le bucket). */
  key: string;
  /** Taille de l'objet en octets. */
  size: number;
  /** Checksum d'intégrité SHA-256 (hex) de l'objet stocké. */
  checksum: string;
  /** Instant d'écriture (ISO 8601). */
  createdAt: string;
}

/**
 * Contrat de stockage objet S3-compatible pour les backups.
 *
 * Toutes les méthodes sont asynchrones : l'implémentation réelle fait des I/O
 * réseau, le mock résout immédiatement. Aucune méthode ne doit fuiter un type
 * propriétaire d'un SDK cloud.
 */
export interface BackupStorage {
  /**
   * Écrit un objet. Idempotent sur la clé (réécriture = remplacement).
   *
   * @param key      - Clé objet
   * @param body     - Contenu binaire (dump chiffré)
   * @param checksum - Checksum SHA-256 (hex) calculé par l'appelant
   * @returns Métadonnées de l'objet écrit (dont taille confirmée)
   */
  put(key: string, body: Buffer, checksum: string): Promise<BackupObjectMeta>;
  /**
   * Lit un objet. Rejette si la clé est absente.
   *
   * @param key - Clé objet
   * @returns Contenu binaire
   */
  get(key: string): Promise<Buffer>;
  /**
   * Métadonnées d'un objet (HEAD), ou `null` si absent — jamais d'exception.
   *
   * @param key - Clé objet
   */
  head(key: string): Promise<BackupObjectMeta | null>;
  /**
   * Liste les métadonnées des objets dont la clé commence par `prefix`,
   * triées par `createdAt` croissant (plus ancien d'abord).
   *
   * @param prefix - Préfixe de clé (ex. `backups/hourly/`)
   */
  list(prefix: string): Promise<BackupObjectMeta[]>;
  /**
   * Supprime un objet. No-op silencieux si la clé est absente (idempotent).
   *
   * @param key - Clé objet
   */
  delete(key: string): Promise<void>;
}

/** Erreur levée quand une clé demandée est absente du stockage. */
export class BackupObjectNotFoundError extends Error {
  /** @param key - Clé objet absente */
  constructor(key: string) {
    super(`Objet de backup introuvable : ${key}`);
    this.name = "BackupObjectNotFoundError";
  }
}
