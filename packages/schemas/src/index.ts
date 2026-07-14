import { z } from "zod";

/** Version du package @sigfa/schemas */
export const SCHEMAS_VERSION = "0.0.0";

/**
 * Schéma UUID v4 partagé.
 * Toutes les entités SIGFA utilisent des UUID v4 comme identifiants.
 */
export const uuidSchema = z.string().uuid();

/** Type inféré de uuidSchema — jamais dupliqué manuellement */
export type UuidSchema = z.infer<typeof uuidSchema>;

/**
 * Schéma d'enveloppe de pagination.
 * Encapsule data + meta (page, limit, total).
 */
export const paginationMetaSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({
    /** Numéro de page courant — entier ≥1 */
    page: z.number().int().min(1),
    /** Taille de page — entier 1–100, défaut 20 */
    limit: z.number().int().min(1).max(100).default(20),
    /** Nombre total d'éléments — entier ≥0 */
    total: z.number().int().min(0),
  }),
});

/** Type inféré de paginationMetaSchema */
export type PaginationMetaSchema = z.infer<typeof paginationMetaSchema>;

/**
 * Schéma d'erreur standardisé SIGFA.
 * code doit être en UPPER_SNAKE_CASE commençant par une lettre.
 */
export const errorSchema = z.object({
  error: z.object({
    /** Code d'erreur conforme à /^[A-Z][A-Z0-9_]*$/ */
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    /** Message d'erreur humain — non vide */
    message: z.string().min(1),
    /** Détails optionnels sous forme de dictionnaire */
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

/** Type inféré de errorSchema */
export type ErrorSchema = z.infer<typeof errorSchema>;

/**
 * Utilitaires de contraste WCAG partagés (theming banque, seed de tenant).
 * Voir ./wcag-contrast.ts — une seule implémentation pour tout le monorepo.
 */
export * from "./wcag-contrast.js";
