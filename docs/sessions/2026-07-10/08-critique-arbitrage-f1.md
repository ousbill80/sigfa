# Session 2026-07-11 — Arbitrage des critiques · VAGUE F1 (Boucle 1, itération 1)

**Verdicts bruts** : completeness → GAPS (2 BLOCKER, 5 MAJOR, 3 MINOR) · ambiguity → AMBIGUOUS (6 BLOCKER, 9 MAJOR, 5 MINOR) · feasibility → CONVERGED (2 « BLOCKER » requalifiés, 4 MAJOR, 3 MINOR).
**Décision** : tous les BLOCKER/MAJOR résolus par amendement v2 des stories + mise à jour de CONTRACT-SPEC.md. Convergence atteinte sous réserve du gate humain.

## Arbitrages structurants (détail complet en annexe ci-dessous)

| # | Critique | Décision | Traduction |
|---|---|---|---|
| G1 | BLOCKER — aucun endpoint audit trail (SEC-001/DB-004 coderaient dans le vide) | **INTÉGRÉ** | CONTRACT-005 : `GET /audit-logs` (SUPER_ADMIN\|AUDITOR) + critère |
| G2 | BLOCKER — droit à l'oubli UEMOA sans endpoint | **INTÉGRÉ** | CONTRACT-005 : `POST /data/purge-phone` † idempotent + `GET /data/retention-policy` |
| A1–A6 | BLOCKER ambiguïté : TTL session borne, format trackingId, outillage « ou équivalent », stratégie $ref/bundle, format X-Idempotency-Key, frontière feedback 001↔003 | **INTÉGRÉ** | Valeurs fixées : session borne JWT 12 h révocable ; trackingId nanoid(21) stocké ; outils épinglés (openapi-typescript ^7 + openapi-fetch, @stoplight/prism-cli ^5, spectral ^6, @redocly/cli ^1 bundle, oasdiff Docker) ; Idempotency-Key string 1..255 + 400/409 ; feedback = CONTRACT-003 exclusivement |
| F1/F2 | « BLOCKER » faisabilité : outillage et job CI inexistants dans le repo | **REQUALIFIÉ-INTÉGRÉ** — ce sont les LIVRABLES de CONTRACT-009, pas des préconditions ; rendus explicites (devDeps, scripts, modification ci.yml consignée comme fichier de couture avec INFRA-007) | CONTRACT-009 v2 |
| F5 | MAJOR — CONTRACT-009 trop gros | **INTÉGRÉ** | Découpage interne 009a (bundle+types+client) / 009b (mock+Schemathesis) / 009c (diff CI+désync) — même story, 3 sous-lots dispatchés séquentiellement |
| G3/G8 | Heartbeat borne + statut imprimante absents | **INTÉGRÉ** | CONTRACT-003 : `POST /kiosks/:kioskId/heartbeat` (printerStatus) ; CONTRACT-002 : événement `kiosk:printer-error` |
| G7+ | File vide à l'appel non contractualisé — et plus profond : « appeler le SUIVANT » (sélection serveur, API-003/004) n'avait AUCUN endpoint | **INTÉGRÉ élargi** | CONTRACT-001 : `POST /counters/:counterId/call-next` (sélection serveur par priorités) → 200 \| 404 `QUEUE_EMPTY` ; `/tickets/:id/call` reste pour appel ciblé/re-appel avec lock 409 |
| G5 | Push mobile sans enregistrement de device | **INTÉGRÉ** | CONTRACT-007 : `POST/DELETE /notifications/devices` |
| A7 | NotificationType : double propriété 005/007 | **INTÉGRÉ variante** — défini dans core.yaml (001), $ref par 005 et 007 : évite de séquencer deux stories parallèles (le critique proposait une dépendance 005→007) | CONTRACT-001 v2 |
| F3 | Webhook WhatsApp : routage multi-tenant non spécifié | **INTÉGRÉ** | CONTRACT-003 : `/webhooks/whatsapp/inbound/{bankSlug}`, secret HMAC par banque ; CONTRACT-007 : `/webhooks/notifications/{provider}/delivery` (A18 fusionné) |
| F6 | Extensions x-* non validées par spectral standard | **INTÉGRÉ** | CONTRACT-001 : règles spectral custom validant les enums x-required-role / x-tenant-scope |
| A16 | Smoke Prism dans chaque story vs 009 | **INTÉGRÉ** | Critères 001–008 reformulés : « exemples présents + valides (spectral) » ; le smoke Prism global appartient à 009b |
| A8–A15, A17–A20, G6, G9, G10, F7–F9 | MAJOR/MINOR de précision (agrégats anonymisés partagés, seuils alerte/anomalie, logo R2, bornes thresholds, masquage téléphone, fenêtre feedback, batch sync 100, CSV, oasdiff vs main, messages accueil, cache trackingId, note charge, note INSUFFICIENT_HISTORY) | **TOUS INTÉGRÉS** | Valeurs chiffrées dans les stories v2 |
| G4 | CONTRACT-SPEC désynchronisé des stories | **INTÉGRÉ** | CONTRACT-SPEC.md amendé (endpoints ajoutés, propriétés annotées par story) — à valider au gate PO |

## Rejets / variantes (transparence)
- **A7** : variante retenue (core.yaml) contre la proposition (dépendance 005→007) — préserve la parallélisation de la vague.
- **F1/F2** : requalifiés — un critique de faisabilité qui exige que le livrable existe avant la story confond précondition et périmètre ; l'intégration a consisté à rendre le périmètre explicite.
- **A3** : client typé = openapi-fetch (écosystème openapi-typescript, zéro codegen client) plutôt que @hey-api — critère « méthode par operationId » reformulé en « accès typé par chemin+méthode couvrant 100% des endpoints ».

## État de convergence
Zéro BLOCKER/MAJOR restant après v2. **Gate humain (PO/Tech Lead) : validation des 9 stories F1 avant dispatch d'agent-contract.**
