# CONTRACT-006 : Contrat reporting & supervision — KPIs, rapports, exports, santé

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/reporting.yaml` ($ref vers core.yaml et agents.yaml)

## Exigences (EARS)

- Le contrat doit définir les **KPIs** : `GET /reports/kpis?scope=agency|network&period=` → TMA, TMT, TTS, taux d'abandon, taux SLA, NPS, occupation — chaque KPI avec unité, définition (glossaire v5 §5 en description) et nullabilité documentée (NPS null si aucun feedback).
- Le contrat doit définir les **rapports** : `GET /reports/daily/:agencyId` (structure du rapport journalier), `GET /reports/benchmark` (classement agences avec statut vert/orange/rouge et seuils documentés).
- Le contrat doit définir les **exports** : `GET /reports/export?format=pdf|xlsx|json&scope=&period=` — réponses par format (content-types), génération asynchrone contractualisée : 202 + `jobId` puis `GET /reports/export/:jobId` (statut, URL de téléchargement signée, expiration) — les rapports agrégés sont anonymisés (UEMOA, documenté).
- Le contrat doit définir la **supervision** : `GET /health` (public, sans auth, schéma minimal), `GET /kiosks/status` (ping bornes par agence — statut, lastSeen), `GET /admin/network-overview` (SUPER_ADMIN, lecture cross-tenant en agrégats anonymisés uniquement — documenté explicitement).
- Chaque route documente scope + rôle (matrice : AUDITOR lit tout, AGENT rien, export = DIRECTOR+/AUDITOR).
- LÀ OÙ le scope est `network`, la réponse ne doit contenir AUCUNE donnée personnelle — encodé par le schéma de base **`AnonymizedNetworkAggregate`** (défini ici dans `components/schemas`, référencé par ai.yaml/CONTRACT-008 — nom canonique, zéro duplication).
- `GET /kiosks/status` doit répondre `{ kiosks: [{ kioskId, agencyId, status, lastSeen, printerStatus }] }` — `lastSeen` et `printerStatus` alimentés par le heartbeat borne (CONTRACT-003).

## Critères d'acceptation

- [ ] `CONTRACT-006: spectral zéro erreur ; $ref croisés résolus (test bundle)`
- [ ] `CONTRACT-006: les 7 KPIs typés avec unités et nullabilité (test)`
- [ ] `CONTRACT-006: export asynchrone — 202 + jobId + polling contractualisés (test)`
- [ ] `CONTRACT-006: AnonymizedNetworkAggregate défini et utilisé par tous les schémas network — zéro champ personnel (test structurel)`
- [ ] `CONTRACT-006: GET /kiosks/status typé avec printerStatus + lastSeen et exemple (test)`
- [ ] `CONTRACT-006: 9 codes + scope + rôle partout ; exemples valides (spectral) — smoke Prism délégué à CONTRACT-009b`

## Hors scope
Calculs réels (REP-001) · planification des envois (REP-002 + CONTRACT-007 pour l'email) · dashboards (WEB-003..005) · IA (CONTRACT-008).
