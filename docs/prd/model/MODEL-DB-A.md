# MODEL-DB-A : Schéma `operations` + `tickets.operation_id` + RLS + migration additive

**Module** : MODÈLE (Phase A) · **Agent** : agent-database · **Dépend de** : MODEL-CONTRACT-A (DONE) · **Statut** : TODO

**Révision** : v2 — arbitrage `_arbitrage.md` (D1, D2, D3, D8). Le schéma Drizzle = vérité du modèle ; conforme à LA LOI (contrat CONTRACT-A).

## Exigences (EARS)
- **Table `operations`** (enfant de `services`) : `id` uuid PK, `service_id` uuid FK→services (RESTRICT), **`bank_id`** uuid NOT NULL + **`agency_id`** uuid NOT NULL (dénormalisés pour RLS/scope, comme les tables existantes), `code` varchar (`^[A-Z0-9]{2,6}$`, **UNIQUE par service**), `name` text NOT NULL, `sla_minutes` int **NULLABLE** (null → hérite du service), `display_order` int, `is_active` bool default true, `icon_key` text NULLABLE, timestamps (`created_at`/`updated_at`). Checks (code format, sla ≥1 si non-null).
- **`tickets.operation_id`** uuid **NULLABLE** FK→operations (RESTRICT). **`tickets.service_id` CONSERVÉ NOT NULL** (dérivé de l'opération applicativement — D1 ; PAS de renommage physique). Index `(operation_id)`.
- **RLS** (D8) : `operations` sous **ENABLE + FORCE ROW LEVEL SECURITY** + policy `tenant_isolation` (`bank_id = current_setting('app.current_bank_id')::uuid`) identique au pattern des 27 tables + `GRANT` à `sigfa_app`. Migration up **ET** down complètes.
- **Migration additive + backfill idempotent** (D3) : les `services` existants **RESTENT des services** ; pour chaque service, créer **une opération « défaut »** (`code` dérivé du service ou `GEN`, `sla_minutes = NULL` → hérite, `name` = nom du service ou « Général », `display_order=0`, `is_active=true`) → un service sans opérations configurées se comporte comme avant. **PAS** de « service par défaut » fourre-tout. Réexécutable sans doublon (ON CONFLICT / garde d'existence).
- **Seed** (`packages/database/src/seed/`) mis à jour : ajoute des opérations sous les services seed (démontre le modèle 2 niveaux).
- **Dette structurelle — LOT DÉDIÉ** : aligner les **~20 fixtures DDL `tickets` inline** des tests (harnais api/Schemathesis/Testcontainers qui redéclarent `CREATE TABLE tickets (... service_id UUID NOT NULL ...)`) → ajouter la table `operations` + la colonne `operation_id` NULLABLE partout où c'est nécessaire pour ne pas casser les 502 tests api. (NB : ces fixtures sont dans `apps/api/**` — voir « Périmètre » ci-dessous.)

## Périmètre & couture
- **Cette story = `packages/database/**`** (schéma Drizzle + migrations + seed + tests DB Testcontainers). 
- Les **fixtures DDL inline dans `apps/api/**`** sont une **COUTURE** : soit tu les listes précisément dans le rapport pour que l'orchestrateur les fasse aligner en MODEL-API-A (qui touche apps/api de toute façon), soit tu signales BLOCKED si elles cassent avant. **NE modifie PAS `apps/api` depuis cette story** (périmètre database strict) — documente la liste exacte des fichiers à aligner.

## Critères d'acceptation
- [ ] `MODEL-DB-A: table operations (FK service, bank_id/agency_id, code unique/service, sla_minutes nullable, PAS de priority) — schéma Drizzle + migration up/down`
- [ ] `MODEL-DB-A: tickets.operation_id NULLABLE FK RESTRICT ; service_id CONSERVÉ NOT NULL`
- [ ] `MODEL-DB-A: RLS FORCE + policy tenant_isolation(bank_id) + GRANT sigfa_app sur operations — suite tenant-isolation PASS (Testcontainers)`
- [ ] `MODEL-DB-A: migration backfill idempotent (1 opération défaut par service existant), rejouable sans doublon ; up/down testées`
- [ ] `MODEL-DB-A: seed enrichi (opérations sous services) ; tests database Testcontainers verts, zéro régression F2`
- [ ] `MODEL-DB-A: liste précise des fixtures DDL inline apps/api à aligner (couture MODEL-API-A) documentée`

## Hors scope
Logique serveur de résolution operation→service (MODEL-API-A) · contrat (CONTRACT-A DONE) · conseillers (Phase B) · UI · fixtures apps/api (couture, alignées en API-A).
