# SIGFA — Monitoring as-code (NET-003)

Plan d'observabilité **as-code** : dashboards Grafana + règles d'alerte infra
(CPU>80% / mem>85% / err>1% sur 5 min, latence RT p95 ≥ 500ms, dépendances down).

## Contenu

- `dashboards/api.json` — latence p50/p95/p99 par route, taux d'erreur 5xx, débit.
- `dashboards/realtime.json` — latence livraison `ticket:called` p95 (SLA 500ms — SEC-004), connexions Socket.io.
- `dashboards/infra.json` — CPU, mémoire, PgBouncer/pool DB, Redis, profondeur/retry/dead-letter BullMQ.
- `dashboards/kiosks.json` — bornes ONLINE/OFFLINE (dérivé ADM-003), échecs de rollout (cohérent NET-002).
- `alert-rules.json` — règles Prometheus/Alertmanager (seuils + `for` fenêtre 5 min) + routage par sévérité + regroupement/dédup 10 min.

Les définitions sont **lintées** (validité structurelle) par
`apps/api/src/observability/dashboard-lint.ts` et sa suite de tests. La logique
d'évaluation des règles (bascule aux bornes, dédup/anti-flapping) vit et est
testée dans `apps/api/src/observability/`.

## GATED sur l'infra réelle (ne PAS considérer « 100% clos » sur mock)

Conformément à l'arbitrage F6–F11 (**D11**), les artefacts ci-dessus sont
livrables **maintenant** mais leur **alimentation et calibrage réels sont GATED**
sur l'infrastructure :

- **Datasources** (Prometheus, Loki, Alertmanager) : à provisionner en env réel.
- **Calibrage des seuils** : la fenêtre 5 min et les seuils par défaut sont
  **à calibrer sur le run de charge SEC-004** (Socket.io p95 <500ms, 100
  tickets/min/agence × 50 agences). Dépendance : **SEC-004**.
- **Destinataires** (`ops`, `on-call`) : **placeholders**. Les canaux réels
  (email/Slack ops, PagerDuty/téléphone astreinte) sont fournis par le **PO/ops**
  avant activation, injectés via `OBS_OPS_RECIPIENT` / `OBS_ONCALL_RECIPIENT`.
- **PII** : les métriques/traces ne portent **jamais** de PII client. Le scrubbing
  Sentry (`pii-scrubber.ts`) est obligatoire et testé (aucun `phone`/`trackingId`).

## Validation sous charge (gated)

Le critère d'acceptation « validé sous charge k6 (SEC-004) — les dashboards
s'alimentent et les seuils déclenchent correctement » est **gated infra** et sera
coché au run de charge réel (hors périmètre testable sur mock).
