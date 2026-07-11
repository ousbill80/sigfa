# Session 2026-07-11 — Boucle 2 · VAGUE F1 (CONTRATS) · Plan de dispatch

**GO humain reçu** (PO) + repo passé PUBLIC + branch protection main/staging posée (4 checks requis, strict).

## Séquencement (DAG f1)
1. **CONTRACT-001** (racine) — agent-contract, seul, directement sur main (aucun autre agent actif). Crée core.yaml + .spectral.yaml + harness de test des contrats + devDeps (yaml, spectral-cli).
2. **CONTRACT-002..007** — 6 agents-contract EN PARALLÈLE (worktrees `wt-contract-00x`, branches `story/contract-00x`) : chacun possède SON fichier YAML/TS + SON fichier de test ; interdiction d'ajouter des devDeps (fournies par 001) → lockfile intact → merges triviaux.
3. **CONTRACT-008** — après merge de 006 (référence AnonymizedNetworkAggregate).
4. **GATE HUMAIN Tech Lead** : validation des 8 contrats → ils deviennent LA LOI.
5. **CONTRACT-009a/b/c** — après le gate.

## Règles injectées à chaque agent
Définition agent-contract verbatim + conventions `_dag.md` f1 + story expansée + interdiction de co-signature + TDD (tests structurels du YAML d'abord, rouge, puis YAML, vert) + hooks lefthook actifs sans bypass.

## Statuts
- CONTRACT-001 : TODO → IN_PROGRESS
