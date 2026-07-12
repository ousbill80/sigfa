# VAGUE F11 — SUPERVISION RÉSEAU MULTI-BANQUES · NOTES RÉDACTEUR

**Révision** : v1 — expansion Boucle 1. Périmètre : NET-001..003.

> F11 est la dernière vague du DAG (dépend de F9/F10). Elle ouvre la surface la plus sensible du produit : la **lecture cross-tenant** (NET-001). Priorité sécurité absolue.

---

## 1. DAG local

```
ADM-003 (supervision bornes) ─┬─► NET-001-API → NET-001-WEB   (cross-tenant lecture seule + console)   [+ SEC-002]
                              └─► NET-002 (rollout centralisé bornes + canary)   (direct)
SEC-004 (charge k6) ──────────────► NET-003 (Grafana/Sentry/alertes)   (direct)
```
Parallélisation : NET-002 et NET-003 sont indépendants de NET-001 et l'un de l'autre (ops distinctes) → dispatchables en parallèle. NET-001 est séquentiel en interne (API amont → WEB aval après DESIGN-gate).

---

## 2. Redécoupages (PRD règle 4 : une story = une couche = un agent)

- **NET-001 est dual-couche** (agent-api + agent-web par le catalogue). Découpé en **NET-001-API** (durcissement/contractualisation platform lecture seule + audit cross-tenant) PUIS **NET-001-WEB** (console). L'orchestrateur SÉQUENCE : API-First → l'UI code sur mock enrichi. Le DESIGN-gate s'applique au sous-lot WEB uniquement.
- NET-002 et NET-003 restent mono-couche (ops/`direct`) — pas de découpage.

---

## 3. Risques (surface cross-tenant = cible sécu prioritaire)

- **R1 — fuite cross-tenant par la console (CRITIQUE)** : tout champ PII/métier qui remonterait par erreur de `network-overview` casse la promesse d'isolation. Mitigation : allow-list stricte côté client + assertion contractuelle (aucun champ PII dans le schéma de réponse) + test SEC-002 étendu au rôle plateforme. La réponse est un AGRÉGAT, jamais une ligne brute.
- **R2 — glissement lecture → écriture** : une future route platform de « correction » romprait le hors-scope définitif. Mitigation : `PLATFORM_READ_ONLY` (403) sur toute mutation platform + hors-scope DÉFINITIF inscrit dans NET-001.
- **R3 — bypass RLS via withPlatform** : si `withPlatform` était réutilisée hors des routes platform listées, l'isolation d'écriture tomberait. Mitigation : liste exhaustive des routes platform (API-002) + test d'isolation de connexion (route platform sous `sigfa_app` → 403).
- **R4 — audit incomplet** : une lecture cross-tenant non tracée = angle mort de conformité. Mitigation : `PLATFORM_READ` audité à CHAQUE ouverture/rafraîchissement (DB-004 immuable).
- **R5 — rollout borne cassé (NET-002)** : une version défectueuse poussée à 100% brique le parc. Mitigation : canary ≤5% + halt automatique >10% échec + rollback vers version stable conservée + preuve d'intégrité (hash signé) avant application.
- **R6 — PII dans les traces Sentry (NET-003)** : téléphones/tracking_id dans les breadcrumbs = fuite. Mitigation : scrubbing obligatoire + test.
- **R7 — tempête d'alertes (NET-003)** : bruit → alertes ignorées. Mitigation : dédup/flapping + routage par sévérité.

---

## 4. Articulation avec les stories amont

- **SEC-002 (tenant-isolation exhaustive)** : NET-001 en dépend et l'ÉTEND au rôle SUPER_ADMIN (`bank_id IS NULL`) : la campagne d'isolation doit prouver que le SUPER_ADMIN ne peut MUTER aucune donnée de banque et ne voit que des agrégats. Ajout attendu à la suite `tenant-isolation` : un axe « rôle plateforme lecture seule ».
- **ADM-003 (supervision bornes)** : source de vérité du statut borne (ping/heartbeat, ONLINE/OFFLINE). NET-001 consomme son agrégat au niveau réseau ; NET-002 consomme la santé borne pour piloter les paliers canary ; NET-003 en dérive le panneau « parc bornes ».
- **API-002 (`withPlatform`)** : couture d'accès cross-tenant. NET-001 ne crée pas de nouveau mécanisme d'accès — il s'appuie sur la connexion plateforme dédiée déjà en place.
- **API-011 (`/kiosks/status`, `/health`, heartbeat `app_version`)** : NET-002 utilise `app_version` pour vérifier l'adoption de version ; NET-003 alerte sur `/health` 503.
- **SEC-004 (charge k6)** : NET-003 réutilise le run de charge pour calibrer/valider seuils et dashboards (p95 500ms notamment).

---

## 5. DESIGN-gates

- **NET-001-WEB (console Super Admin)** — écran majeur de pilotage réseau. Gate d'orchestrateur : wireframe ASCII + inventaire des 5 états (nominal/loading/empty/error/offline) + emplacement de la mention de garantie « agrégat réseau — aucune donnée client », livrés en début de story ; l'implémentation n'est dispatchée qu'après GO humain. Régression visuelle : screenshots FR + EN commités.
- NET-002 / NET-003 : pas de DESIGN-gate (ops, pas d'écran client majeur ; un éventuel panneau ops interne reste hors gate).

---

## 6. Ajouts de contrat nécessaires (amont, API-First)

Le contrat existant (CONTRACT-006 §Supervision) porte DÉJÀ : `GET /admin/network-overview` (SUPER_ADMIN, cross-tenant, agrégats anonymisés), `GET /kiosks/status`, `GET /health`. Ajouts à contractualiser AVANT implémentation :

1. **`network-overview` — schéma d'agrégat explicite** (allow-list) : figer les champs autorisés (compteurs par banque : agences, bornes ONLINE/OFFLINE, tickets agrégés, uptime, santé vert/orange/rouge ; totaux réseau) et documenter explicitement l'ABSENCE de PII/contenu métier. Additif si enrichissement → **oasdiff NON-BREAKING**.
2. **Code d'erreur `PLATFORM_READ_ONLY`** (403) pour toute tentative de mutation sur périmètre platform — additif au schéma d'erreur standard.
3. **NET-002 — surface rollout borne** : à trancher — routes de gestion de version/rollout (`platform`, ops) OU pipeline hors API applicative ? Recommandation : garder la mécanique de rollout hors contrat client public (ops/CI + événements borne existants), en réutilisant le heartbeat `app_version` comme signal d'adoption. Événement borne d'échec d'intégrité à formaliser (candidat : type d'alerte supervision).
4. **NET-003** : pas d'ajout au contrat client (métriques infra = plan d'observabilité séparé Grafana/Sentry, pas d'API métier).

---

## 7. Questions ouvertes

1. **NET-001** : `network-overview` expose-t-il les banques par identifiant OPAQUE ou par nom en clair ? (Le nom d'une banque cliente est-il « métier sensible » vis-à-vis de la plateforme ?) — défaut proposé : identifiant + libellé banque autorisés (la plateforme les connaît par contrat commercial), PII client toujours exclue.
2. **NET-002** : la chaîne de signature d'artefact (clé, CI, notarisation Electron) est-elle disponible en F11 ou repoussée à l'intégration matérielle pilote ? Impacte la « preuve d'intégrité ».
3. **NET-002** : critère de progression de palier = MANUEL (gate humain ops) ou AUTOMATIQUE après fenêtre verte ? Défaut retenu : manuel jusqu'au palier 25%, automatique au-delà si vert — à entériner.
4. **NET-003** : destinataires concrets (adresses/canaux ops + astreinte on-call) — à fournir par le PO/ops avant activation.
5. **NET-003** : fenêtre par défaut 5 min pour CPU/mem/err — à calibrer sur le run SEC-004 réel.

---

## 8. Hors scope DÉFINITIF de la vague (rappel)

Écriture cross-tenant (toute forme) · contournement de RLS · exposition de PII client ou de contenu métier d'une banque à la plateforme · CRM/lien client↔donnée (CLAUDE.md §5). Ces frontières ne sont jamais négociables à l'implémentation.
