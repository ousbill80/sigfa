# REP-003b : Surface web exports & benchmarking inter-agences

**Module** : F7 — Reporting · **Agent** : agent-web · **Dépend de** : REP-003 (endpoints export/benchmark), WEB-001 (shell/RBAC/theming), WEB-004 (dashboard direction réseau — hôte du benchmarking) · **Statut** : TODO

> **Redécoupage** (issu de REP-003) : couche **surface web**. Déclenchement d'export, suivi asynchrone (polling), téléchargement, et **affichage du benchmarking inter-agences** (classement + statut couleur). Aucune génération de fichier ni calcul côté web : consomme le contrat REP-003 (client typé CONTRACT-009). Le benchmarking s'insère dans le dashboard direction réseau (WEB-004), pas un écran isolé.

**Fichiers pressentis** (agent-web) : `apps/web/app/(dashboard)/reports/export/*` (bouton export + suivi job) · composant `BenchmarkTable`/carte statut intégré à WEB-004 · client typé via `@sigfa` généré (CONTRACT-009). Design : tokens WEB-001, rouge réservé aux alertes (cohérent WEB-003).

## Exigences (EARS)

- **UBIQUITAIRE** — La surface consomme UNIQUEMENT le client typé du contrat (REP-003/CONTRACT-006) — aucun fetch vers une route absente du contrat (API-First).
- **UBIQUITAIRE** — Accès export réservé aux rôles DIRECTOR+/AUDITOR (RBAC WEB-001) ; le déclencheur est masqué/désactivé pour les autres rôles.
- **ÉVÉNEMENT** — QUAND l'utilisateur déclenche un export (format + scope + période), l'UI appelle `POST /reports/export`, affiche l'état « génération en cours » et **poll** `GET /reports/export/:jobId` jusqu'à `READY`/`FAILED`.
- **ÉVÉNEMENT** — QUAND le job est `READY`, l'UI propose le téléchargement via l'URL signée ; à expiration, elle propose de **relancer** l'export.
- **ÉVÉNEMENT** — QUAND le dashboard réseau charge le benchmarking, l'UI affiche le classement des agences avec pastilles **vert/orange/rouge/n-a** conformes aux statuts renvoyés par REP-003 (aucune re-catégorisation côté client).
- **ÉTAT** — 5 états par surface : nominal, loading (génération/poll), empty (aucune agence/donnée → message humain, pas d'écran vide), error (échec export → message humain + relance), offline.
- **INDÉSIRABLE** — SI l'export échoue (`FAILED`) ou l'URL est expirée, ALORS message humain explicite + action de relance (jamais un lien mort silencieux).
- **INDÉSIRABLE** — SI le benchmarking est de portée réseau, l'UI n'affiche aucun nom d'agent (cohérent avec l'anonymisation amont) — elle ne fabrique aucune PII.

## Critères d'acceptation

- [ ] `REP-003b: déclencheur export → POST puis polling jusqu'à READY/FAILED (test composant, client mocké)`
- [ ] `REP-003b: READY → bouton téléchargement (URL signée) ; expiré → relance proposée (test)`
- [ ] `REP-003b: benchmarking — pastilles vert/orange/rouge/n-a = statut serveur, zéro re-catégorisation client (test)`
- [ ] `REP-003b: RBAC — export masqué pour AGENT/rôles non autorisés (test)`
- [ ] `REP-003b: 5 états (nominal/loading/empty/error/offline) rendus (tests + snapshots)`
- [ ] `REP-003b: FR/EN sans clé i18n brute ni débordement (snapshot ×2 langues)`
- [ ] `REP-003b: theming tenant + rouge réservé aux alertes (design-gate)`

## Hors scope de cette story

Génération de fichiers & calcul benchmarking (REP-003, agent-api) · dashboards KPI temps réel (WEB-003..005) · rapports planifiés email (REP-002/REP-002b) · IA (F10).
