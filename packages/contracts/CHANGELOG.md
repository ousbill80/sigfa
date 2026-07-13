# Changelog — @sigfa/contracts

Journal des évolutions des contrats OpenAPI (LA LOI des échanges client↔serveur).
Convention : les changements additifs passent le gate `contract-diff` (oasdiff) ;
tout breaking change doit être documenté ici et assumé par une décision PO.

## 2026-07-13 — BREAKING : restriction des langues à FR/EN (décision PO)

Retrait des langues Dioula et Baoulé du périmètre produit (décision PO actée,
breaking change assumé — le gate oasdiff `contract-diff` signalera ce retrait
comme breaking sur toute PR : c'est attendu et couvert par cette note).

- `agents.yaml` (`info.version` 1.0.0 → **2.0.0**)
  - `AgentLanguage` : enum `FR | DIOULA | BAOULE | EN` → `FR | EN`
    (retrait de valeurs d'enum = breaking pour les clients qui envoyaient
    `DIOULA`/`BAOULE` dans `languages` — désormais 422).
- `admin.yaml` (`info.version` 1.0.0 → **2.0.0**)
  - `WelcomeMessages` : retrait des propriétés optionnelles `dioula` et `baoule`
    (`additionalProperties: false` → toute soumission de ces champs = 422).

Migration DB associée : `packages/database/migrations/0011_restrict_agent_language.sql`
(recréation du type PostgreSQL `agent_language` en `('FR','EN')`, nettoyage des
données `DIOULA`/`BAOULE` existantes).
