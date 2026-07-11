# SIGFA — SETUP

## Prérequis
Node 22 LTS · pnpm 9 · Docker · Claude Code v2.1.154+ (plan avec workflows dynamiques)

## 1. Initialiser
```bash
pnpm dlx create-turbo@latest . --package-manager pnpm   # ou structure manuelle
docker compose up -d                                     # postgres16 + redis7
pnpm install
```

## 2. Vérifier l'enforcement
- `.claude/settings.json` présent (hook orchestrateur actif)
- `lefthook install` puis commit d'un .ts sans test → doit être rejeté (T1)

## 3. Première session (l'ordre est la méthode)
```bash
claude   # /effort high
```
> Tu es l'orchestrateur SIGFA. Lis CLAUDE.md, docs/SIGFA_PROMPT_v5.md et
> docs/prd/PRD_PRODUIT.md. Lance la vague F0 (INFRA-001..005) : expanse
> chaque story au gabarit, fais-la critiquer par les 3 critiques, puis
> dispatche. Journalise dans docs/sessions/.

Puis : F1 (contrats → gate humain Tech Lead → génération mock) →
F2 → F3 ∥ F4 (les clients codent sur mock EN MÊME TEMPS que l'API) →
RT (bascule) → F6..F11.

## 4. Gates humains (jamais sautés)
PRD expansé validé (PO) · Contrat validé (Tech Lead) · Wireframes écrans majeurs ·
Stories BLOCKED (3 échecs) · Fin de vague : démo staging · CRITICAL sécurité : rollback.

## 5. Environnements
dev: local Docker · staging: Railway (auto sur push staging) · prod: tag git manuel.
Secrets uniquement en variables d'env (.env.example maintenu à jour).
