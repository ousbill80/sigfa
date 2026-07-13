/**
 * Point d'entrée `@sigfa/database/test-support` — utilitaires de test partagés.
 *
 * Exposé pour que les tests d'intégration d'autres packages (ex. `apps/api`)
 * appliquent les migrations SQL réelles sur une PostgreSQL Testcontainers via un
 * import de PACKAGE (jamais un import relatif inter-package, interdit par lint).
 *
 * @module
 */

export {
  applyMigrations,
  listMigrationFiles,
  splitStatements,
} from "./migrate.js";
