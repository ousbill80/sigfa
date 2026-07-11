# SIGFA — HOOKS D'ENFORCEMENT

Deux hooks rendent les règles incontournables (la guidance seule se dilue en longue session).

## 1. block-main-thread-writes (.claude/hooks/, câblé via .claude/settings.json)
Événement PreToolUse sur Edit|Write|MultiEdit. Si le thread principal (orchestrateur)
tente d'écrire dans apps/ ou packages/ → exit 2, l'appel est bloqué, le message renvoyé
au modèle lui rappelle de dispatcher un subagent (CLAUDE.md §2). Les subagents ne portent
pas ce hook : eux seuls écrivent le code.

## 2. require-test-in-commit (.claude/hooks/, à lier aussi en pre-commit git via lefthook)
Règle T1. Tout fichier source (ts/tsx hors .test/.spec, generated/, migrations/, *.d.ts,
*.config.*) présent dans un commit sans fichier de test correspondant → commit rejeté
avec la liste des fichiers orphelins. Le code sans test n'atteint jamais la CI.

## Installation
1. `.claude/settings.json` est déjà câblé pour le hook 1.
2. Hook 2 côté git : `lefthook.yml` →
   pre-commit: { commands: { t1: { run: bash .claude/hooks/require-test-in-commit.sh } } }
3. Vérifier : tenter un Write orchestrateur sur apps/ (doit bloquer), commiter un .ts
   sans test (doit rejeter).
