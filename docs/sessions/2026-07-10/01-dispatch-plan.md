# Session 2026-07-10 — Plan de dispatch · VAGUE F0 (Boucle 1)

**Orchestrateur** : Fable 5 (thread principal — zéro diff produit par lui-même)
**Vague** : F0 — FONDATIONS (INFRA-001 → INFRA-005)
**Boucle** : Boucle 1 (auto-conception PRD) — AUCUN code avant GO humain explicite

## DAG de la vague

```
INFRA-001 (monorepo — racine absolue)
   ├──► INFRA-002 (Docker Compose dev)      ─┐
   ├──► INFRA-003 (CI GitHub Actions)        ├─ parallélisables entre elles
   ├──► INFRA-004 (hooks git lefthook)       │  (aucun fichier commun)
   └──► INFRA-005 (@sigfa/schemas·factories·testing) ─┘
```

## Étapes de la Boucle 1

| # | Étape | Acteur | Sortie | Statut |
|---|---|---|---|---|
| 1 | Expansion des 5 stories au gabarit §2 (EARS + critères testables + hors scope) | Fable 5 | `docs/prd/f0/INFRA-00x.md` + `_dag.md` | IN_PROGRESS |
| 2 | Critique adversariale — fan-out PARALLÈLE | critic-completeness · critic-ambiguity · critic-feasibility (contextes injectés depuis `.claude/agents/`) | 3 verdicts JSON | TODO |
| 3 | Arbitrage : intégrer/rejeter chaque critique avec justification écrite | Fable 5 | `02-critique-arbitrage.md` + stories amendées | TODO |
| 4 | GATE HUMAIN : validation PO des stories convergées | Product Owner | GO / corrections | TODO |
| 5 | (après GO) Boucle 2 : dispatch séquencé — INFRA-001 seul, puis 002‖003‖004‖005 | agents d'exécution (INFRA-001..004 : direct · INFRA-005 : agent-database) | code+tests+doc, TDD rouge→vert avec `red_run_output` | TODO |

## Rappels d'enforcement actifs
- Le thread principal n'écrit que sous `docs/` (les stories PRD sont son artefact légitime) ; `apps/` et `packages/` = subagents uniquement (hook `block-main-thread-writes`).
- Contrats de sortie JSON exigés de chaque subagent ; toute story d'implémentation sans `red_run_output` = REJET.
- 3 échecs sur une story → BLOCKED + escalade humaine + `/lesson`.

## Note d'orchestration
- Les agents nommés `critic-*` sont définis dans `sigfa-kit/.claude/agents/` ; la session tournant depuis le répertoire parent, ils sont dispatchés comme subagents généraux avec leur fichier de définition injecté verbatim comme contexte — même angle, même format de sortie JSON.
- INFRA-005 est assigné à `agent-database` par le PRD alors que son périmètre nominal est `packages/database/` ; pour cette story son périmètre est étendu explicitement à `packages/{schemas,factories,testing}` (décision consignée, à confirmer au gate humain).
