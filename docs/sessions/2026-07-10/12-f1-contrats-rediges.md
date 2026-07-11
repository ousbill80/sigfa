# Session 2026-07-11 — VAGUE F1 · Les 8 contrats sont rédigés → GATE TECH LEAD

## État : CONTRACT-001..008 en REVIEW — 7 fichiers OpenAPI 3.1 + 1 contrat d'événements, 111 tests de contrat verts, spectral zéro erreur (règles custom x-* incluses), 48/48 tâches monorepo, zéro co-signature.

| Contrat | Fichier | Endpoints/Événements | Points saillants |
|---|---|---|---|
| 001 cœur | openapi/core.yaml | 24 paths (~31 ops) | Machine à états ticket + 409 ILLEGAL_TRANSITION · call-next serveur + 404 QUEUE_EMPTY · lock 409 TICKET_ALREADY_CLAIMED · sync batch ≤100 · IdempotencyKey partagé · schémas transverses (TicketStatus, Role, NotificationChannel ≠ NotificationType) · ruleset spectral custom |
| 002 temps réel | events/realtime.ts | 10 événements | Zod + z.infer · TICKET_CALLED_SLA_MS=500 exporté · kiosk:printer-error · sync:request/state · rooms agency:{id} |
| 003 public | openapi/public.yaml | 8 | Session borne 12 h + révocation · heartbeat printerStatus · oneOf/discriminator par canal · trackingId nanoid(21), uuid interne jamais exposé · feedback 422/409/422 · webhook inbound/{bankSlug} HMAC · Cache-Control/ETag |
| 004 agents | openapi/agents.yaml | 4 | Machine à états agent + 409 dédié · langues FR/DIOULA/BAOULE/EN · import CSV ≤500 lignes rapport ligne à ligne · règle « self » |
| 005 admin | openapi/admin.yaml | 11 | **Audit trail GET /audit-logs (AUDITOR)** · **droit à l'oubli purge-phone † idempotent + retention-policy** · theming R2 signé + appliedColors · thresholds bornés · 409 AGENCY_HAS_OPEN_TICKETS |
| 006 reporting | openapi/reporting.yaml | 7 | 7 KPIs typés (nps nullable) · exports asynchrones 202+jobId+polling · **AnonymizedNetworkAggregate** (schéma canonique) · /kiosks/status avec printerStatus · /health public |
| 007 notifications | openapi/notifications.yaml | 8 | phoneNumberMasked partout · devices push idempotents · opt-in UEMOA · webhooks delivery par provider |
| 008 IA | openapi/ai.yaml | 6 | 422 INSUFFICIENT_HISTORY {requiredDays:90} · AiMeta partout · seuil AGENT_INACTIVE_PATTERN chiffré · $ref AnonymizedNetworkAggregate |

## Corrections orchestrateur en cours de vague
- CONTRACT-001 retry 1 : `NotificationType` confondu avec le canal → scindé en `NotificationChannel` + `NotificationType` (types de messages) — couture attrapée à la relecture, corrigée avant que 005/007 ne consomment.
- Note technique propagée entre agents : OAS 3.1 + spectral/nimma — pas de `nullable: true` ; prudence sur `type: [x, 'null']` (007 a rencontré un crash nimma, contourné proprement ; 008 prévenu, aucun crash).
- Incident d'orchestration : `git merge` échoue silencieusement dans une boucle `for` (interaction lefthook/stdin) → merges unitaires avec `< /dev/null`. À retenir.

## GATE HUMAIN (Tech Lead) — requis maintenant
Relire les 7 YAML + realtime.ts (`packages/contracts/`) : cohérence REST, nommage, idempotence, sécurité tenant. **Validation = le contrat devient LA LOI** → dispatch CONTRACT-009a/b/c (bundle redocly, types+client, mock Prism, Schemathesis, diff CI) → F2 (DATA) et F4 (clients sur mock) débloquées.
