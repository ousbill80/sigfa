-- Down de 0011_restrict_agent_language.sql : restaure le type agent_language
-- à 4 valeurs (FR, DIOULA, BAOULE, EN).
--
-- ATTENTION : les données DIOULA/BAOULE nettoyées par le up (users.languages,
-- tickets.required_language) ne sont PAS restaurées — perte assumée (décision
-- PO 2026-07). Ce down ne restaure que la FORME du type.
--> statement-breakpoint

ALTER TYPE "public"."agent_language" RENAME TO "agent_language_new";
--> statement-breakpoint

CREATE TYPE "public"."agent_language" AS ENUM('FR', 'DIOULA', 'BAOULE', 'EN');
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

DROP TYPE "public"."agent_language_new";
--> statement-breakpoint

COMMENT ON COLUMN "tickets"."required_language" IS
  'Langue préférée du porteur pour le routage par API-004. '
  'Nullable — optionnelle (NULL = aucune contrainte de langue). '
  'Valeurs : FR | DIOULA | BAOULE | EN (enum agent_language, LA LOI AgentLanguage).';
