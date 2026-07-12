# F10 — IA & PRÉDICTION · Notes d'expansion (Boucle 1)

> **Statut de la vague** : PRD PRÊT (5 stories expansées). **Implémentation runtime GATED** sur l'accumulation de **données réelles de production** (seuil v1 : **90 jours** de tickets fermés par agence, aligné CONTRACT-008 `INSUFFICIENT_HISTORY`).
> Cette vague est un **cas particulier** : on écrit tout le PRD maintenant, mais on ne dispatche l'implémentation runtime qu'une fois l'historique pilote disponible. **Ce qui est backtestable / mockable est développable dès maintenant.**

---

## 1. Testable AVANT données réelles vs GATED

### ✅ Testable AVANT production (jeux synthétiques / backtest / mock — marqué ⊛ dans les stories)

- **IA-001** : toute la logique de pipeline sur **datasets synthétiques** — idempotence upsert, calendrier CI déterministe (fériés seed DB-003), features lag, `is_partial`, `available_days`, isolation tenant, backtest reproductible, bucket 30/60 min.
- **IA-002** : forecast sur données synthétiques, `drivers[]` (explicabilité), dérivation staffing, acquittement, garde-fou « humain dans la boucle » (aucune mutation auto), `422 INSUFFICIENT_HISTORY`, **backtest MAE/MAPE/calibration**, **non-régression vs baseline naïve**.
- **IA-003** : détection sur **scénarios étiquetés synthétiques** (QUEUE_STUCK / AGENT_INACTIVE_PATTERN / SLA_SYSTEMIC), cycle open/acked/resolved, idempotence, evidence, anti-faux-positif (scénario nominal → 0 anomalie), précision/rappel/F1.
- **IA-004** : NLP sur **corpus FR/EN annoté** — sentiment/thèmes/score, redaction PII, INSUFFICIENT_SAMPLE, parité FR vs EN, précision/rappel/F1, isolation tenant, garde « pas d'envoi tiers ».
- **IA-005** : **toute l'UI sur le mock CONTRACT-008** (Prism) — nominal, `422 INSUFFICIENT_HISTORY` comme vue de première classe, lowConfidence, 5 états, RBAC, i18n FR/EN, régression visuelle. C'est le gain **API-First** : l'UI n'attend ni les moteurs ni les données réelles.

### ⛔ GATED sur données réelles de production (1 critère « pilote » par story, hors CI)

- IA-001 : premier run réel sur historique pilote ≥ 90 j.
- IA-002 : **cible de MAE en production** (seuil à arrêter avec le PO).
- IA-003 : **taux de faux positifs** sous cible sur trafic réel.
- IA-004 : **publication des scores** au-dessus du seuil de volume réel.
- IA-005 : surfaces **peuplées de prédictions réelles** validées en pilote.

**Conséquence dispatch** : IA-001..005 peuvent être **implémentées et mergées** (logique + tests synthétiques/mock verts) SANS attendre la production. Seuls les critères « pilote » restent ouverts jusqu'à disponibilité de l'historique. La vague n'est donc **pas 100 % bloquée**.

---

## 2. Risques

| Risque | Impact | Mitigation proposée (à valider PO) |
|---|---|---|
| **Hébergement du modèle** | Où tournent entraînement/inférence ? Un service externe = risque confidentialité/souveraineté UEMOA. | **Par défaut : modèle hébergé DANS l'infra SIGFA (intra-tenant)**. Aucun appel sortant vers un service tiers d'IA sans base légale. Modèles simples/interprétables privilégiés (aide à l'explicabilité). |
| **Confidentialité des feedbacks (IA-004)** | Commentaires = texte libre pouvant contenir de la PII (nom, téléphone, propos identifiants). | Redaction/anonymisation **avant** stockage d'insight ; verbatims expurgés ; aucun envoi tiers par défaut ; conformité `insights sans PII` (CONTRACT-008). |
| **Biais du scoring qualité (IA-004)** | Un score qualité auto par agent peut être injuste (échantillon faible, biais linguistique, contexte). | `INSUFFICIENT_SAMPLE` (pas de publication sous seuil), parité FR/EN mesurée, score **décomposable/explicable**, **jamais** de sanction RH automatique. |
| **Biais / dérive du forecast** | Événements exceptionnels (grève, panne réseau) polluent l'historique. | `is_partial`, marquage des jours anormaux, garde-fou non-régression vs baseline, `lowConfidence`. |
| **Faux positifs anomalies (IA-003)** | Le bruit détruit la confiance opérationnelle. | Seuils configurables (thresholds CONTRACT-005), scénario nominal → 0 anomalie exigé, F1 mesuré. |
| **Sur-confiance / boîte noire** | La direction pourrait suivre aveuglément l'IA. | **Explicabilité obligatoire** partout (`drivers`/`evidence`/décomposition), libellés advisory, humain décideur. |
| **Décision automatique interdite contournée** | Tentation d'automatiser l'ouverture de guichet. | Garde-fou testé (aucune mutation opérationnelle émise par les moteurs IA / l'UI). |

---

## 3. Questions PO (ouvertes)

1. **[TRANCHÉE] Langues NLP** : le catalogue dit « FR + langues locales ». **Décision PO : FR/EN UNIQUEMENT** (Dioula/Baoulé retirés). Appliquée dans IA-004 et IA-005. → **résolue**, notée ici pour traçabilité de l'écart catalogue.
2. **Cible de MAE / qualité forecast** en production (IA-002) : seuil chiffré à arrêter avec le PO. → **ouverte**.
3. **Seuil de volume minimal** de feedbacks avant publication d'un score agent/agence (IA-004) : valeur exacte. → **ouverte**.
4. **Hébergement du modèle** : confirmer « intra-infra SIGFA, aucun tiers » comme règle définitive, ou définir une base légale UEMOA si un service tiers est un jour envisagé. → **ouverte**.
5. **Horizon de prévision** : J..J+7 proposé — confirmer (impacte staffing et COMEX). → **ouverte**.

*(open_questions_count = 4 ; la question langues est comptée comme tranchée, non ouverte.)*

---

## 4. Ajouts de contrat nécessaires (contract additions — CONTRACT-008, agent-contract, extensions NON-BREAKING)

Ces champs ne figurent pas (ou pas en détail) dans CONTRACT-008 et doivent être ajoutés **avant l'implémentation runtime** des champs concernés, via une story contrat additive (oasdiff NON-BREAKING), puis répercutés dans le **mock Prism** consommé par IA-005 :

1. **IA-001/002** : `AiMeta.dataWindow` doit exposer `featureSetVersion` + `availableDays` (lisibles côté front pour l'état « X/90 jours »).
2. **IA-002** : champ `drivers[]` (explicabilité forecast : `{ factor, direction, weight }`) sur les points/journées de `/ai/forecast` ; flag `lowConfidence` sur les points.
3. **IA-003** : champ `evidence` structuré sur les anomalies (`{ metric, threshold, window, sample }`) + référence aux alertes agrégées (sans double comptage).
4. **IA-004** : énumération des `themes[]`, `qualityScore` décomposé (contributions), état `INSUFFICIENT_SAMPLE`, valeur `language: unsupported` sur `/ai/feedback-insights`.

> **Règle constitution** : aucune de ces stories ne crée de route hors CONTRACT-008. Toute nouvelle surface d'échange = story CONTRACT amont d'abord (racine du DAG). Les additions ci-dessus sont **additives/optionnelles** (non-breaking) pour ne pas casser le mock existant.

---

## 5. Respect du hors-scope DÉFINITIF (constitution §5) — vérifié

- ❌ Pas de CRM, ❌ pas de lien client↔conseiller attitré, ❌ pas de Core Banking / Mobile Money / USSD / BCEAO, ❌ **zéro biométrie** (le commentaire vocal borne KIOSK-009 est transcrit en texte, jamais utilisé pour identifier une personne).
- ❌ Aucune PII exportée vers un service tiers d'IA sans base légale UEMOA (défaut : aucun envoi tiers).
- ❌ Aucune décision opérationnelle / RH automatique — humain dans la boucle partout.
- ✅ Isolation stricte intra-tenant sur tous les moteurs et surfaces.
- FR/EN uniquement.

**hors_scope_respecte = true.**
