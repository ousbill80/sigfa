# docs/ — Index de navigation

> **Rôle de ce fichier** : rendre la documentation navigable pour un humain qui (re)prend le projet.
> Il sépare ce qui **fait foi aujourd'hui** (normatif) de ce qui est **conservé pour mémoire** (historique).
> Mis à jour : 2026-07-13. Si tu ajoutes ou supplante un document, mets cet index à jour (voir « Conventions » en bas).

---

## 🚀 Commencer ici

Ordre de lecture pour comprendre le projet en une session :

1. [`../README.md`](../README.md) — vue d'ensemble du kit (2 min)
2. [`SIGFA_PROMPT_v5.md`](./SIGFA_PROMPT_v5.md) — **le produit** : quoi, pour qui, périmètre, stack
3. [`SIGFA_METHODE_CONCEPTION_AGENTIQUE.md`](./SIGFA_METHODE_CONCEPTION_AGENTIQUE.md) — **la méthode** : orchestration, boucles, API-First, Test Total
4. [`SIGFA_DESIGN_SYSTEM_v2.md`](./SIGFA_DESIGN_SYSTEM_v2.md) — **le design** (v2 « Sérénité Premium » — la v1 est supplantée)
5. [`prd/PRD_PRODUIT.md`](./prd/PRD_PRODUIT.md) — **le backlog maître** : 8 modules, DAG, stories EARS
6. [`../CLAUDE.md`](../CLAUDE.md) — la constitution chargée à chaque session · [`../HOOKS.md`](../HOOKS.md) — enforcement · [`../SETUP.md`](../SETUP.md) — démarrer

Pour savoir **où en est le projet** : [`prd/_roadmap-100.md`](./prd/_roadmap-100.md) (suivi vivant) puis la dernière session dans [`sessions/`](#-historique--sessions-journal-dorchestration).

---

## 📐 Documents NORMATIFS (font autorité aujourd'hui)

| Document | Rôle | Version qui fait foi |
|---|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | Constitution du projet, chargée à chaque session | vivante (racine du kit) |
| [`../HOOKS.md`](../HOOKS.md) | Hooks d'enforcement (écritures orchestrateur, test-in-commit) | vivante |
| [`../SETUP.md`](../SETUP.md) | Démarrage, gates humains, environnements | vivante |
| [`SIGFA_PROMPT_v5.md`](./SIGFA_PROMPT_v5.md) | Référence produit | **v5.0** (juillet 2026) |
| [`SIGFA_METHODE_CONCEPTION_AGENTIQUE.md`](./SIGFA_METHODE_CONCEPTION_AGENTIQUE.md) | Référence méthode | **v2.0** (juillet 2026) |
| [`SIGFA_DESIGN_SYSTEM_v2.md`](./SIGFA_DESIGN_SYSTEM_v2.md) | Référence design « Sérénité Premium » | **v2.0** (fait foi depuis 2026-07-12) |
| [`prd/PRD_PRODUIT.md`](./prd/PRD_PRODUIT.md) | Backlog maître exécutable | v1.0 (produit complet, pas de MVP) |
| [`prd/CONTRACT-SPEC.md`](./prd/CONTRACT-SPEC.md) | Périmètre du contrat OpenAPI (entrée d'agent-contract) | vivante |
| [`prd/_roadmap-100.md`](./prd/_roadmap-100.md) | Suivi vivant Boucle 2 F6-F11 | vivante ⚠️ écrite par le terminal parallèle |
| [`prd/_arbitrage-f6-f11.md`](./prd/_arbitrage-f6-f11.md) | Décisions exécutoires F6-F11 (GO PO 2026-07-12) | vivante ⚠️ terminal parallèle |
| [`prd/model/_arbitrage.md`](./prd/model/_arbitrage.md) | Décisions exécutoires du modèle Services · Opérations · Conseillers | vivante ⚠️ terminal parallèle |

Décisions PO transverses en vigueur (reflétées dans CLAUDE.md §8) : **2 langues FR/EN** (Dioula/Baoulé retirés) · **pas d'app mobile cliente** (SMS + web public, mobile archivée dans `archive/mobile-v0`) · theming banque = `--brand` seul token tenant.

### PRD par vague — [`prd/`](./prd/)

⚠️ **Zone active** : un terminal parallèle écrit dans `prd/` (roadmap F6-F11). Ne pas déplacer/renommer.

| Dossier | Contenu | Statut |
|---|---|---|
| `prd/f0/` | INFRA-001..008 (fondations) | ✅ vague clôturée |
| `prd/f1/` | CONTRACT-001..012 (contrats = LA LOI) | ✅ clôturée |
| `prd/f2/` | DB-001..009 (données, 27 tables RLS) | ✅ clôturée |
| `prd/f3/` | API-001..011 (API cœur) | ✅ clôturée |
| `prd/f4/` | KIOSK/WEB/TV/MOB (clients sur mock) | ✅ clôturée (stories MOB-* conservées pour historique — app mobile retirée du périmètre) |
| `prd/rt/` | RT-001..003 (bascule temps réel) | ✅ clôturée |
| `prd/f6/`..`prd/f11/` | NOTIF · REP · ADM · SEC · IA · NET | 🔄 en cours (terminal parallèle, voir `_roadmap-100.md`) |
| `prd/model/` | Modèle métier Services · Opérations · Conseillers | 🔄 en cours |
| `prd/*/_dag.md`, `_notes.md` | DAG et notes de chaque vague | suivent le statut de leur vague |

---

## ⚠️ SUPPLANTÉ (conservé, ne plus utiliser comme référence)

| Document | Supplanté par | Depuis |
|---|---|---|
| [`SIGFA_DESIGN_SYSTEM.md`](./SIGFA_DESIGN_SYSTEM.md) (design v1) | [`SIGFA_DESIGN_SYSTEM_v2.md`](./SIGFA_DESIGN_SYSTEM_v2.md) | 2026-07-12 |

Chaque document supplanté porte un bandeau en tête. On ne supprime pas, on ne déplace pas : on bannière et on indexe.

---

## 📜 HISTORIQUE — design-gates ([`design-gates/`](./design-gates/))

Wireframes ASCII soumis au gate humain, **validés par le PO le 2026-07-11** (session `22-design-gate-valide.md`). Figés : ils documentent ce qui a été approuvé avant implémentation ; le rendu actuel fait foi dans le code + design system v2.

- [`design-gates/kiosk-wireframes.md`](./design-gates/kiosk-wireframes.md) — KIOSK-002..005 (note : rédigés à l'époque « 4 langues » — décision PO ultérieure = FR/EN uniquement)
- [`design-gates/web-tv-wireframes.md`](./design-gates/web-tv-wireframes.md) — TV-001 · WEB-002 · WEB-003 (le statut « EN ATTENTE GO » en tête est antérieur au GO du 2026-07-11)

---

## 📜 HISTORIQUE — sessions (journal d'orchestration)

⚠️ **Zone active** : le terminal parallèle écrit dans `sessions/`. Ne rien déplacer/renommer.
Convention : `sessions/{date}/NN-titre.md`, numérotation continue. Les numéros 24-29 n'existent pas (travail du terminal parallèle non journalisé ici). Le dossier `2026-07-10/` couvre aussi les sessions du 07-11 (dossier ouvert le 10, sessions enchaînées).

### [`sessions/2026-07-10/`](./sessions/2026-07-10/) — vagues F0 → F4 (10-12 juillet)

| Fichier | Résumé |
|---|---|
| `01-dispatch-plan.md` | Plan de dispatch vague F0 (Boucle 1) |
| `02-critique-arbitrage.md` | Arbitrage des critiques F0 |
| `03-boucle2-infra-001-dispatch.md` | Boucle 2 : dispatch INFRA-001 |
| `04-infra-001-report.md` | Rapport INFRA-001 — PASS → DONE |
| `05-boucle2-f0-dispatch.md` | Dispatch parallèle INFRA-002‖003‖004‖005 |
| `06-integration-f0-report.md` | Intégration F0 sur main — gate 48/48 vert |
| `07-panel-f0-synthese.md` | Boucle 3 : panel adversarial F0 + premier run CI |
| `08-critique-arbitrage-f1.md` | Arbitrage des critiques F1 |
| `09-corrections-f0-integration.md` | Corrections panel F0 (INFRA-007/008), clôture Boucle 3 |
| `10-cloture-vague-f0.md` | **Clôture F0** — CI GitHub Actions verte |
| `11-boucle2-f1-dispatch.md` | Dispatch vague F1 (contrats) |
| `12-f1-contrats-rediges.md` | 8 contrats OpenAPI rédigés → gate Tech Lead |
| `13-gate-tech-lead-valide.md` | Gate Tech Lead validé — CONTRACT-001..008 = LA LOI |
| `14-panel-f1-synthese.md` | Panel adversarial F1 → CONTRACT-010 |
| `15-cloture-vague-f1.md` | **Clôture F1** — 10 stories, LA LOI enforcée |
| `16-critique-arbitrage-f2.md` | Arbitrage F2 — découverte : LA LOI contredisait le produit |
| `17-boucle2-f2-dispatch.md` | Dispatch vague F2 (données) |
| `18-panel-f2-et-cloture.md` | **Clôture F2** — 27 tables sous scan RLS, 206 tests |
| `19-critique-arbitrage-f3-f4.md` | Arbitrage F3+F4 → amendement CONTRACT-012 |
| `20-boucle2-f3-f4-dispatch.md` | Dispatch F3‖F4 (API cœur ‖ clients sur mock) |
| `21-f3f4-salve1.md` | F3‖F4 salve 1 intégrée |
| `22-design-gate-valide.md` | **Design-gate validé par le PO** (wireframes kiosk/web/TV) |
| `23-f3f4-salve2-ci-verte.md` | F3‖F4 salve 2 — CI verte 6 jobs |

### [`sessions/2026-07-12/`](./sessions/2026-07-12/) — Boucle 3 F3/F4, RT, durcissements

| Fichier | Résumé |
|---|---|
| `30-boucle3-panel-f3-arbitrage.md` | Panel adversarial Boucle 3 sur F3 (API-001..011) + arbitrage |
| `31-critique-arbitrage-rt.md` | Arbitrage vague RT — refonte du bus socket |
| `32-rt-003-e2e-electron-status.md` | RT-003 : E2E Playwright réels + statut Electron |
| `33-boucle1-panel-f4-arbitrage.md` | Panel F4 (kiosk/web+TV/mobile) + arbitrage |
| `34-boucle2-f4-fixes-securite.md` | 8 correctifs sécurité S1-S8 livrés (rouge→vert) |
| `35-durcissement-token-tv-public.md` | Durcissement token d'affichage TV public + réparation build contracts |
| `36-panel-durcissement-tv-findings.md` | Panel sur le durcissement TV — findings + correctifs |
| `37-revue-modele-metier.md` | Revue croisée du modèle métier (Services · Opérations · Conseillers) |
| `38-tv-hardening-v2-api.md` | Lot TV-hardening-v2 (agent-api, worktree) |

---

## ✍️ Conventions — où écrire quoi à l'avenir

| Je veux… | J'écris dans… |
|---|---|
| Journaliser une session d'orchestration | `sessions/{date}/NN-titre.md` (numérotation continue, une ligne de résumé à ajouter ici) |
| Ajouter/expander une story | `prd/{vague}/XXX-nnn.md` + DAG de la vague (`_dag.md` ou `_notes.md`) |
| Consigner un arbitrage de vague | `prd/{vague}/_arbitrage*.md` ou la session du jour |
| Créer un nouveau document de référence | `docs/` racine, avec en-tête **version + date + statut**, et une ligne dans la table « normatifs » ci-dessus |
| Remplacer un document de référence | Nouveau fichier versionné (`*_vN.md`) + **bandeau « SUPPLANTÉ »** en tête de l'ancien + mise à jour de cet index et des pointeurs (CLAUDE.md, README racine). **Jamais de suppression ni de déplacement.** |
| Soumettre un écran au design-gate | `design-gates/` (wireframe → GO humain → figé) |

Règles de la zone : `sessions/` et `prd/` peuvent être écrites par plusieurs terminaux — **ne jamais déplacer/renommer les fichiers d'autrui**, et ne committer que ses propres fichiers.
