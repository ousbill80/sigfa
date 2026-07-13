-- MODEL-DB (décision PO 2026-07) : restriction de l'enum agent_language à FR/EN.
-- Appliqué après 0010_relationship_manager.sql.
--
-- Contexte :
--   Décision PO : les langues Dioula (DIOULA) et Baoulé (BAOULE) sont retirées
--   du périmètre produit. LA LOI `AgentLanguage` (contracts v2.0.0) devient
--   `FR | EN`. PostgreSQL ne permet pas de retirer une valeur d'un type enum :
--   la stratégie est de recréer le type puis de re-typer les colonnes.
--
-- Contenu :
--   1. Nettoyage des données : retrait de DIOULA/BAOULE des tableaux
--      `users.languages` (repli '{FR}' si vide) ; `tickets.required_language`
--      remis à NULL (préférence optionnelle) si DIOULA/BAOULE.
--   2. Recréation du type : rename → create → re-typage des colonnes → drop.
--   3. Commentaire de colonne mis à jour (documentation en base).
--
-- Colonnes concernées (seules utilisations du type agent_language) :
--   - users.languages           agent_language[] NOT NULL DEFAULT '{FR}'
--   - tickets.required_language agent_language   NULL
--
-- Migration down : 0011_restrict_agent_language.down.sql
--> statement-breakpoint

UPDATE "users"
   SET "languages" = COALESCE(
         NULLIF(array_remove(array_remove("languages", 'DIOULA'::"agent_language"), 'BAOULE'::"agent_language"), '{}'),
         '{FR}'::"agent_language"[]
       )
 WHERE "languages" && ARRAY['DIOULA'::"agent_language", 'BAOULE'::"agent_language"];
--> statement-breakpoint

UPDATE "tickets"
   SET "required_language" = NULL
 WHERE "required_language" IN ('DIOULA'::"agent_language", 'BAOULE'::"agent_language");
--> statement-breakpoint

ALTER TYPE "public"."agent_language" RENAME TO "agent_language_old";
--> statement-breakpoint

CREATE TYPE "public"."agent_language" AS ENUM('FR', 'EN');
--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "languages" DROP DEFAULT;
--> statement-breakpoint

ALTER TABLE "users"
  ALTER COLUMN "languages" TYPE "agent_language"[]
  USING "languages"::text[]::"agent_language"[];
--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "languages" SET DEFAULT '{FR}'::"agent_language"[];
--> statement-breakpoint

ALTER TABLE "tickets"
  ALTER COLUMN "required_language" TYPE "agent_language"
  USING "required_language"::text::"agent_language";
--> statement-breakpoint

DROP TYPE "public"."agent_language_old";
--> statement-breakpoint

COMMENT ON COLUMN "tickets"."required_language" IS
  'Langue préférée du porteur pour le routage par API-004. '
  'Nullable — optionnelle (NULL = aucune contrainte de langue). '
  'Valeurs : FR | EN (enum agent_language, LA LOI AgentLanguage — '
  'DIOULA/BAOULE retirés par décision PO 2026-07, migration 0011).';
