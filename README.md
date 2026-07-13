# SIGFA — Système Intelligent de Gestion des Files d'Attente
### Plateforme SaaS multi-tenant · Banques de Côte d'Ivoire · 100% standalone

Développé en **agentic engineering** : Claude Fable 5 orchestre, Claude Sonnet exécute,
le PRD est le contrat, tout code naît avec son test.

## Ordre de lecture
**Index complet de la documentation (normatif vs historique) : [`docs/README.md`](docs/README.md).**

1. `docs/SIGFA_PROMPT_v5.md` — le produit (quoi, pour qui, périmètre, stack)
2. `docs/SIGFA_METHODE_CONCEPTION_AGENTIQUE.md` — la méthode (orchestration, boucles, API-First, Test Total)
3. `docs/SIGFA_DESIGN_SYSTEM_v2.md` — le design v2 « Sérénité Premium » (la v1 est supplantée)
4. `docs/prd/PRD_PRODUIT.md` — le backlog exécutable (8 modules, DAG, stories EARS)
5. `CLAUDE.md` — la constitution chargée à chaque session
6. `SETUP.md` — démarrer

## Les 5 règles en une ligne chacune
Contrat OpenAPI avant tout code · L'orchestrateur ne code jamais · Un agent = une couche ·
Code+test+doc = un commit · 3 échecs = escalade humaine.

## Structure
```
CLAUDE.md              constitution        .claude/agents/   13 agents
docs/prd/              backlog + contrat   .claude/hooks/    2 enforcements
docs/SIGFA_*.md        les 3 références    docs/sessions/    audit trail
apps/ packages/        le code (produit dérivé du PRD)
```
