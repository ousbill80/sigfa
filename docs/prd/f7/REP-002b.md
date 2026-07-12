# REP-002b : Gabarits de documents rapport — React Email + PDF « COMEX 1 page »

**Module** : F7 — Reporting · **Agent** : agent-web · **Dépend de** : REP-002 (payload de données), WEB-001 (tokens/theming tenant) · **Statut** : TODO

> **Redécoupage** (issu de REP-002) : couche **rendu de documents** séparée de la planification (REP-002, agent-api). Cette story livre UNIQUEMENT des **gabarits** (React Email pour le corps du mail + gabarit PDF pour la pièce jointe, dont le format « COMEX 1 page »). Elle NE planifie rien, NE calcule aucun KPI, NE contacte aucune queue : elle transforme un **payload normalisé** (fourni par REP-002) en documents.

**Fichiers pressentis** (agent-web) : `apps/web/emails/report-daily.tsx`, `report-weekly-network.tsx`, `report-monthly-quality.tsx` (React Email) · `apps/web/reporting/pdf/*` (gabarit PDF, ex. `@react-pdf/renderer` ou HTML→PDF côté serveur — techno à confirmer, voir `_notes.md`) · gabarit `comex-one-page.tsx`. Theming via tokens WEB-001 (branding tenant : logo, `--brand`, contraste WCAG auto — cf. mémoire theming).

## Exigences (EARS)

- **UBIQUITAIRE** — Chaque gabarit prend en entrée le **payload normalisé REP-002** (KPIs + méta période/portée/tenant) et ne fait AUCUN calcul métier — rendu pur (données → document).
- **UBIQUITAIRE** — Les documents respectent le **theming tenant** (logo, couleur brand, contraste ≥ WCAG AA auto-corrigé) via les tokens WEB-001 — habillage jamais structure.
- **UBIQUITAIRE** — Tous les libellés sont **FR/EN uniquement** (i18n WEB-001), selon la préférence de langue du destinataire (défaut FR).
- **UBIQUITAIRE** — Le rapport **COMEX** tient sur **une seule page** : au plus 3 KPIs stratégiques mis en avant + tendance vs période précédente ; densité contrôlée (test de débordement).
- **ÉVÉNEMENT** — QUAND REP-002 fournit un payload journalier/hebdo/mensuel, le gabarit correspondant produit (a) un corps d'email React Email et (b) la pièce jointe PDF associée.
- **ÉTAT** — TANT QU'un KPI du payload est `null`, le gabarit affiche **« N/A »** (jamais `0`, jamais case vide ambiguë).
- **ÉTAT** — TANT Qu'un rapport est de portée réseau, le gabarit n'affiche que des agrégats (aucun nom d'agent) — cohérent avec l'anonymisation amont.
- **INDÉSIRABLE** — SI le rendu PDF échoue (police manquante, payload malformé), ALORS le gabarit lève une erreur explicite renvoyée à REP-002 (qui déclenche retry/dead-letter) — jamais un PDF corrompu ou vide silencieux.
- **INDÉSIRABLE (reduced-motion / accessibilité mail)** — L'email est **statique** (pas d'animation), compatible clients mail courants (tables, styles inline) — pas de dépendance JS côté client mail.

## Critères d'acceptation

- [ ] `REP-002b: chaque gabarit rend depuis le payload REP-002 sans calcul métier (test de rendu par fixture)`
- [ ] `REP-002b: COMEX tient sur 1 page — snapshot PDF, aucun débordement (test de régression)`
- [ ] `REP-002b: theming tenant appliqué (logo + brand + contraste ≥ AA) — 2 tenants distincts rendus (test)`
- [ ] `REP-002b: KPI null → « N/A » dans email ET PDF (test)`
- [ ] `REP-002b: réseau → aucun nom d'agent dans le document rendu (test)`
- [ ] `REP-002b: FR et EN rendus sans débordement ni clé i18n brute (snapshot ×2 langues)`
- [ ] `REP-002b: payload malformé / police manquante → erreur explicite (pas de PDF vide) (test)`
- [ ] `REP-002b: email = HTML statique inline, zéro JS client (test de conformité)`

## Hors scope de cette story

Planification & envoi (REP-002 / NOTIF-004) · calcul KPI (REP-001) · dashboards interactifs (WEB-003..005) · exports à la demande (REP-003b) · impression physique.
