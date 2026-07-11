# CONTRACT-009 : Génération outillée — bundle, types TS, client typé, mock Prism, Schemathesis, diff de contrat CI

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001..008 (DONE + gate humain Tech Lead) · **Statut** : TODO
**Fichiers possédés** : `packages/contracts/{generated/**, scripts/**, package.json, .redocly.yaml}` + job CI (couture `.github/workflows/ci.yml` — intégration séquencée par l'orchestrateur, fichier possédé par INFRA-007 côté F0)
**Révision** : v2 — amendée après critique · **Découpage interne : 3 sous-lots dispatchés séquentiellement (009a → 009b → 009c)**
**Amendement PO intégré** : le diff de contrat CI (C4) fait partie de cette story.

## Livrables explicites (requalification critique faisabilité : ces éléments n'existent pas encore — les créer EST la story)
devDependencies de `@sigfa/contracts` : `@redocly/cli@^1`, `openapi-typescript@^7`, `openapi-fetch@^0.12`, `@stoplight/prism-cli@^5`, `@stoplight/spectral-cli@^6` ; scripts `bundle`, `generate`, `mock`, `lint:contract` ; oasdiff via image Docker `tufin/oasdiff` (pas de dépendance npm).

## Exigences (EARS)

### 009a — bundle + types + client
- QUAND `pnpm --filter @sigfa/contracts bundle` est exécuté, redocly doit produire un YAML **bundlé** par module dans `generated/bundled/` (résolution des $ref inter-fichiers — stratégie unique du pipeline ; `.redocly.yaml` commité déclare les 8 APIs).
- QUAND `generate` est exécuté, le système doit produire depuis les bundles : types TS par module (`openapi-typescript`), et exposer le **client typé** via `openapi-fetch` (accès typé par chemin+méthode couvrant 100% des endpoints, erreurs typées par code) — consommé par web/kiosk/mobile.
- La génération doit être **déterministe** : deux exécutions → zéro diff (aucun horodatage généré).

### 009b — mock + Schemathesis
- `pnpm --filter @sigfa/contracts mock` : Prism démarre sur les 8 bundles (ports par module documentés dans `.env.example` — seule modification hors packages/contracts, consignée).
- Squelettes **Schemathesis** par module branchés sur le harness `packages/testing/src/contract/` (F0) : le SKIP devient exécution réelle contre le mock (fumée).

### 009c — enforcement CI
- Job `contract-diff` dans ci.yml : QUAND une PR modifie `packages/contracts/openapi/**`, comparer avec `origin/main` (oasdiff Docker) ; SI breaking change sans montée `/api/v2`, ALORS échec listant les breakings ; changement additif → vert ; pas de diff si branche = main.
- SI `generate` produit un diff non commité dans `generated/`, ALORS la CI échoue (« generated désynchronisé — relancez generate »).

## Critères d'acceptation
- [ ] `CONTRACT-009: bundle → 8 YAML résolus ; chaîne $ref à 3 niveaux (ai→reporting→core) résolue (test)`
- [ ] `CONTRACT-009: generate → types + client pour les 8 modules ; typecheck strict vert sur generated/`
- [ ] `CONTRACT-009: generate 2× → zéro diff (déterminisme)`
- [ ] `CONTRACT-009: client typé couvre 100% des endpoints (test d'inventaire chemins×méthodes vs YAML)`
- [ ] `CONTRACT-009: mock Prism démarre sur les 8 bundles et répond aux exemples (smoke)`
- [ ] `CONTRACT-009: Schemathesis (harness F0) passe contre le mock (fumée)`
- [ ] `CONTRACT-009: breaking simulé → job diff rouge listant ; additif → vert (tests du script)`
- [ ] `CONTRACT-009: generated désynchronisé simulé → CI rouge message actionnable (test)`

## Hors scope
Implémentation des routes (F3) · consommation par les apps (F4) · publication npm · versioning /api/v2 réel.
