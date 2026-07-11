# INFRA-004 : Hooks git (lefthook) — require-test-in-commit (T1) + commitlint

**Module** : F0 — Fondations · **Agent** : direct (agent unique infra) · **Dépend de** : INFRA-001 · **Statut** : DONE (2026-07-11 — 1 retry : variable inutilisée ; hooks actifs et vérifiés en conditions réelles, 19 tests)
**Révision** : v2 — amendée après critique (Boucle 1, itération 1)

## Exigences (EARS)

- Le système doit installer **lefthook `^1.7`** avec un hook `pre-commit` exécutant `require-test-in-commit` (adapté du script du kit `.claude/hooks/`) : SI le diff stagé contient un fichier source `*.ts`/`*.tsx` nouveau ou modifié sous `apps/` ou `packages/` sans test correspondant touché dans le même commit, ALORS le commit est **rejeté** avec la liste exacte des fichiers en défaut et le rappel de la règle T1.
- **Règle de correspondance source↔test** (exacte, codée et testée) : pour `<dir>/<nom>.ts(x)`, correspond un fichier `<nom>.test.ts(x)` ou `<nom>.spec.ts(x)` situé dans le même dossier ou dans `<dir>/__tests__/`, présent dans le diff stagé. **Règle de repli** : à défaut de correspondance nominale, tout fichier de test touché appartenant au **même workspace pnpm** est accepté. Chaque règle a son cas de test dédié.
- **Exemptions** — deux mécanismes distincts, jamais mélangés :
  - `lefthook/test-exemptions.txt` versionné, **globs uniquement** (un par ligne, commentés) : fichiers de test eux-mêmes, `*.config.{ts,js,mjs}`, `*.d.ts`, `packages/database/migrations/**`, `packages/contracts/generated/**`. Toute nouvelle exemption = amendement commité de ce fichier, jamais de bypass CLI documenté.
  - Détection **barrel codée dans le script** (pas un glob) : un `index.ts` modifié est exempté SI chaque ligne non vide/non commentaire matche `^export (\*|\{[^}]*\}) from` — couvert par deux tests (barrel pur → accepté ; index.ts avec logique → rejeté).
- **Renommage pur** : statut `R100` dans `git diff --cached --name-status -M` → accepté sans test ; tout `R<100` est traité comme modification et exige un test.
- Le système doit installer un hook `commit-msg` avec **commitlint `^19`** (`@commitlint/config-conventional`) : SI le message ne respecte pas Conventional Commits, ALORS rejet avec un exemple valide affiché.
- QUAND `pnpm install` est exécuté à la racine, lefthook doit s'installer automatiquement (script `prepare` — ajouté au `package.json` racine par cette story lors de son **intégration séquentielle**, voir `_dag.md`).
- Le script `require-test-in-commit` est lui-même testé (Test Total) : suite Vitest (exécution via execa sur un dépôt git temporaire) couvrant au minimum les 7 cas des critères ci-dessous.

## Critères d'acceptation

- [ ] `INFRA-004: commit d'un .ts source seul sous apps/ ou packages/ → rejeté, message listant le fichier`
- [ ] `INFRA-004: commit du même .ts + son .test.ts (même dossier ou __tests__/) → accepté`
- [ ] `INFRA-004: repli — source + un autre test touché du même workspace → accepté ; test d'un autre workspace → rejeté`
- [ ] `INFRA-004: fichier exempté par glob seul (migration générée, *.d.ts, *.config.ts) → accepté`
- [ ] `INFRA-004: barrel index.ts pur → accepté ; index.ts contenant une fonction → rejeté`
- [ ] `INFRA-004: renommage R100 → accepté ; renommage R<100 sans test → rejeté`
- [ ] `INFRA-004: commit ne touchant que docs/ → accepté sans exigence de test`
- [ ] `INFRA-004: message "wip" → rejeté par commitlint ; "feat(api): émission ticket" → accepté`
- [ ] `INFRA-004: après pnpm install à froid, .git/hooks contient les hooks lefthook (prepare exécuté)`

## Hors scope de cette story

- Les hooks Claude Code (`.claude/hooks/block-main-thread-writes.sh` — périmètre orchestration, pas git)
- L'enforcement CI de la couverture (INFRA-003 — T1 côté poste dev et ratchet côté CI se complètent)
- Vérifications pre-push lourdes (la CI couvre)
- Signature de commits / GPG
- Le mapping stories ↔ tests nommés (T3 — porté par test-coverage-checker en Boucle 3)
