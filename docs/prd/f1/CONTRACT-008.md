# CONTRACT-008 : Contrat IA — prédictions affluence, staffing, anomalies, NLP feedbacks

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001, CONTRACT-006 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/openapi/ai.yaml` ($ref vers core.yaml et reporting.yaml)

## Exigences (EARS)

- Le contrat doit définir la **prédiction d'affluence** : `GET /ai/forecast?agencyId=&date=` → séries horaires prédites `{ hour, expectedTickets, confidence }` + facteurs contextuels énumérés (fin de mois, paie fonction publique, férié) ; SI l'historique est insuffisant (**seuil fixe v1 : 90 jours** de tickets fermés), ALORS 422 `INSUFFICIENT_HISTORY` avec `details: { requiredDays: 90, availableDays }` ; l'`info.description` du YAML documente que TOUS les endpoints IA répondent ainsi tant que l'historique est insuffisant (état transitoire attendu par les frontends).
- Le contrat doit définir les **recommandations staffing** : `GET /ai/staffing-recommendations?agencyId=&date=` → liste `{ time, action, counters, rationale }` (ex. « ouvrir 2 guichets à 10h30 »), avec statut d'acquittement (`POST /ai/staffing-recommendations/:id/ack`).
- Le contrat doit définir les **anomalies** : `GET /ai/anomalies?status=open|acked|resolved` — types énumérés (QUEUE_STUCK, AGENT_INACTIVE_PATTERN, SLA_SYSTEMIC) + `POST /ai/anomalies/:id/ack` ; frontière avec `alert:manager` (CONTRACT-002) chiffrée : l'alerte est instantanée (1 occurrence), l'anomalie est un motif agrégé — défaut documenté : `AGENT_INACTIVE_PATTERN` = ≥3 alertes `AGENT_INACTIVE` sur 7 jours glissants pour le même agent (seuils via `/banks/:id/thresholds`, CONTRACT-005).
- Le contrat doit définir les **insights feedbacks** : `GET /ai/feedback-insights?period=&scope=` → sentiments agrégés, thèmes récurrents, scoring qualité par agence/agent — les schémas réseau héritent de **`AnonymizedNetworkAggregate`** défini dans reporting.yaml (CONTRACT-006, $ref — jamais de redéfinition).
- Toutes les réponses IA doivent porter les métadonnées de modèle : `{ modelVersion, computedAt, dataWindow }` (schéma commun `AiMeta`).
- Scope + rôle : lecture DIRECTOR+ (agency) / réseau (bank) ; UBIQUITAIRE — aucune donnée externe au tenant dans les prédictions (modèles entraînés sur données SIGFA de la banque uniquement, documenté).

## Critères d'acceptation

- [ ] `CONTRACT-008: spectral zéro erreur ; $ref croisés core+reporting résolus (test bundle)`
- [ ] `CONTRACT-008: forecast — 422 INSUFFICIENT_HISTORY { requiredDays: 90, availableDays } + confidence typée (test)`
- [ ] `CONTRACT-008: seuil AGENT_INACTIVE_PATTERN (≥3 sur 7 j) documenté (test structurel)`
- [ ] `CONTRACT-008: anomalies — enum types + cycle open/acked/resolved (test)`
- [ ] `CONTRACT-008: AiMeta présent sur toutes les réponses IA (test structurel)`
- [ ] `CONTRACT-008: insights sans données personnelles brutes (test structurel)`
- [ ] `CONTRACT-008: 9 codes + scope + rôle partout ; exemples valides (spectral) — smoke Prism délégué à CONTRACT-009b`

## Hors scope
Modèles et pipeline (F10 : IA-001..005) · surfaces dashboard (IA-005/WEB-005) · alertes temps réel (CONTRACT-002).
