# Changelog — @sigfa/contracts

Journal des évolutions des contrats OpenAPI (LA LOI des échanges client↔serveur).
Convention : les changements additifs passent le gate `contract-diff` (oasdiff) ;
tout breaking change doit être documenté ici et assumé par une décision PO.

## 2026-07-14 — Additif : GET /agencies/{id} accessible AGENT (bandeau session)

Demande PO : toutes les consoles connectées affichent l'agence de rattachement
de l'utilisateur. Le web résout le nom de l'agence côté serveur via
`GET /agencies/{id}` : le rôle requis passe de `AGENCY_DIRECTOR` à `AGENT`
(relaxation de lecture, non-breaking pour tous les clients existants).

- `core.yaml` (`info.version` 1.0.0 → **1.1.0**)
  - `GET /agencies/{id}` : `x-required-role` `AGENCY_DIRECTOR` → `AGENT`.
    Le `x-tenant-scope: agency` est INCHANGÉ : un utilisateur ne lit que les
    agences de son claim `agencyIds` (hors périmètre → 403). Sécurité-neutre :
    aucune nouvelle donnée exposée hors du périmètre tenant de l'appelant.

## 2026-07-14 — CONTRACT-014 : dispo conseillers + bankId session borne + exports sous-chemins (additif, non-breaking)

Trois évolutions groupées (décision PO — audit UX borne + dettes consignées).
100% additif : le gate `contract-diff` (oasdiff) passe sans breaking change.

- `public.yaml` (`info.version` 1.0.0 → **1.1.0**)
  - `PublicRelationshipManager` : nouveau champ **`available: boolean`** (required
    en réponse — additif non-breaking, le serveur le calcule toujours). Présence du
    conseiller AUJOURD'HUI, **dérivée serveur du statut temps réel de la machine à
    états agents**. JAMAIS d'horaire personnel ni de planning exposé (zéro PII, D5) ;
    `additionalProperties: false` préservé. Le client borne/web sait si le conseiller
    qu'il choisit est là.
  - `KioskSessionResponse` : nouveau champ **`bankId` (string uuid, required)** —
    donnée d'enseigne publique de la banque de la borne. Permet le theming
    (couleur `--brand`, logo) depuis la session, et élimine la variable
    d'environnement `NEXT_PUBLIC_BANK_ID` côté borne.

- `package.json` — **fix des exports de sous-chemins** (dette : le dist API n'était
  pas exécutable sans hook de résolution) :
  - `"./events/*": "./dist/events/*"` — couvre `@sigfa/contracts/events/realtime.js`
    (seul sous-chemin réellement importé par les apps, vérifié par grep).
  - `".": "./dist/index.js"` → `"./dist/src/index.js"` — l'entrée est émise par tsc
    en `dist/src/index.js` (`rootDir: "."`) ; l'ancienne cible n'existait pas.

Impacts consommateurs (stories suivantes) :
- `apps/api` : dériver `available` (machine à états agents) dans la liste publique
  conseillers ; renvoyer `bankId` dans `POST /kiosk/session` ; les alias de
  résolution (`vitest.config.ts`, `tsconfig.json` paths sur
  `@sigfa/contracts/events/realtime.js`) deviennent supprimables.
- `apps/kiosk` : consommer `bankId` de la session (suppression de
  `NEXT_PUBLIC_BANK_ID`) et afficher la disponibilité du conseiller.

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
