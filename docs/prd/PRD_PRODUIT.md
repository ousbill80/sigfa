# SIGFA — PRD PRODUIT COMPLET
## Catalogue exécutable · 8 modules · Stories EARS · DAG global

> **Version** : 1.0 · Périmètre : **PRODUIT COMPLET** — aucun découpage MVP.
> Le séquencement suit uniquement les **dépendances techniques** (contrat → data → api → clients), pas une logique de version réduite. Tout ce qui suit est livré.
>
> **Usage** : ce document est le backlog maître. Avant chaque vague d'exécution, l'orchestrateur (Fable 5, Boucle 1) **expanse** les stories de la vague au format détaillé (gabarit §2) et les fait converger via les 3 critiques. Les stories marquées ★ sont déjà expansées ici comme références de niveau d'exigence.
>
> Statuts : `TODO → IN_PROGRESS → REVIEW → DONE | BLOCKED`

---

## 1. DAG GLOBAL DU PRODUIT

```
F0 FONDATIONS ──► F1 CONTRATS ──► F2 DATA ──┬─► F3 API CŒUR ──► F5 CLIENTS TEMPS RÉEL
                     │                      │        │              (web, kiosk, TV)
                     │ (mock généré)        │        │
                     └──────────────────────┼────────┼─► F4 CLIENTS SUR MOCK
                                            │        │   (kiosk, web, mobile
                                            │        │    démarrent SANS attendre F3)
                                            ▼        ▼
                                    F6 NOTIFICATIONS & JOBS ──► F7 REPORTING
                                            │
                                            ▼
                          F8 ADMIN & THEMING ──► F9 SÉCURITÉ RENFORCÉE & CHARGE
                                            │
                                            ▼
                              F10 IA & PRÉDICTION ──► F11 SUPERVISION RÉSEAU
```

Règle : à l'intérieur d'une vague, les stories sans fichiers communs se dispatchent **en parallèle**.

---

## 2. GABARIT DE STORY (rappel — format d'expansion obligatoire)

```markdown
## STORY-XXX : <titre>
**Module** : N · **Agent** : agent-x · **Dépend de** : [...] · **Statut** : TODO
### Exigences (EARS)          ← patterns UBIQUITAIRE/QUAND/SI/LÀ OÙ/anormal
### Critères d'acceptation    ← chaque case = un test nommé "STORY-XXX: ..."
### Hors scope de cette story ← frontières explicites
```

---

## 3. CATALOGUE DES STORIES

### F0 — FONDATIONS (agent selon fichier · racine absolue)

| ID | Story | Agent | Dépend de |
|---|---|---|---|
| INFRA-001 | Monorepo pnpm + Turborepo, apps/ + packages/, configs partagées | direct | — |
| INFRA-002 | Docker Compose dev : postgres16 + redis7 + api + web + kiosk | direct | 001 |
| INFRA-003 | CI GitHub Actions : lint → typecheck → test → build, ratchet couverture | direct | 001 |
| INFRA-004 | Hooks git (lefthook) : require-test-in-commit + commitlint | direct | 001 |
| INFRA-005 | Packages @sigfa/schemas, @sigfa/factories (fixtures depuis Zod), @sigfa/testing squelettes des 5 suites critiques | agent-database | 001 |

### F1 — CONTRATS (agent-contract · LA LOI avant tout code)

| ID | Story | Dépend de |
|---|---|---|
| CONTRACT-001 ★ | Contrat cœur : tenants, auth, agences, services, guichets, files, tickets | INFRA-005 |
| CONTRACT-002 | Contrat événements Socket.io temps réel (ticket:created/called/closed, counter:status, queue:updated, agency:offline) | 001 |
| CONTRACT-003 | Contrat client public : émission ticket (borne/QR/mobile/WhatsApp), suivi, feedback | 001 |
| CONTRACT-004 | Contrat agents & compétences : profils, statuts, affectations, transferts | 001 |
| CONTRACT-005 | Contrat admin : rôles RBAC, config banque/agence, templates, onboarding | 001 |
| CONTRACT-006 | Contrat reporting : KPIs, rapports, exports (PDF/Excel/JSON) | 001 |
| CONTRACT-007 | Contrat notifications : SMS, WhatsApp, email, push (templates par banque, opt-in) | 001 |
| CONTRACT-008 | Contrat IA : prédictions affluence, recommandations staffing, anomalies, NLP feedbacks | 001, 006 |
| CONTRACT-009 | Génération outillée : types TS + client typé + MOCK Prism + squelettes Schemathesis pour chaque contrat | 001–008 |

#### ★ CONTRACT-001 (expansée — référence de niveau d'exigence)

**Agent** : agent-contract · **Dépend de** : INFRA-005

**Exigences (EARS)**
- Le contrat doit définir toutes les ressources cœur : `/banks`, `/agencies`, `/services`, `/counters`, `/queues`, `/tickets`, `/auth` en OpenAPI 3.1 sous `/api/v1`.
- Le contrat doit définir pour CHAQUE endpoint les réponses 2xx, 400, 401, 403, 404, 409, 422, 429, 500 avec le schéma d'erreur standard.
- Le contrat doit documenter le scope tenant (bank/agency) et le claim JWT requis pour chaque route.
- QUAND une mutation est critique (POST /tickets, PATCH /tickets/:id/close, POST /sync), le contrat doit exiger le header `X-Idempotency-Key` et documenter la sémantique de rejeu (même clé → même réponse, 24h).
- La machine à états du ticket doit être encodée dans le contrat : `WAITING → CALLED → SERVING → DONE | NO_SHOW | ABANDONED | TRANSFERRED`, toute transition illégale → 409.

**Critères d'acceptation**
- [ ] `CONTRACT-001: le YAML est valide OpenAPI 3.1 (spectral lint zéro erreur)`
- [ ] `CONTRACT-001: chaque endpoint expose les 9 codes de réponse avec schéma`
- [ ] `CONTRACT-001: chaque route documente scope tenant + claim`
- [ ] `CONTRACT-001: les mutations critiques documentent X-Idempotency-Key`
- [ ] `CONTRACT-001: le mock Prism démarre et répond aux exemples du contrat`

**Hors scope** : implémentation (API-0xx), événements (CONTRACT-002).

---

### F2 — DATA (agent-database)

| ID | Story | Dépend de |
|---|---|---|
| DB-001 ★ | Schéma cœur Drizzle : Bank, Agency, Service, Queue, Counter, Ticket, User, AgencyUser + enums | CONTRACT-001 |
| DB-002 | Policies RLS sur toutes les tables + middleware SQL `app.current_bank_id` + suite tenant-isolation initiale | DB-001 |
| DB-003 | Migrations initiales + seed : services par défaut (OC/OA/CR/CH/EN/VIP/RE/EP avec SLA), rôles, jours fériés CI | DB-002 |
| DB-004 | Tables audit_log (immuable, rétention 24 mois) + triggers d'écriture | DB-001 |
| DB-005 | Tables notifications (templates par banque, opt-in, journal d'envoi) | DB-001, CONTRACT-007 |
| DB-006 | Tables reporting (agrégats journaliers matérialisés, index bank_id+date) | DB-001, CONTRACT-006 |
| DB-007 | Tables IA (prédictions, anomalies, scores) + rétention | DB-006, CONTRACT-008 |
| DB-008 | Chiffrement AES-256 des téléphones + purge auto 13 mois (droit à l'oubli UEMOA) | DB-001 |

#### ★ DB-001 (expansée)

**Exigences (EARS)**
- Chaque table métier doit porter `bank_id` (uuid, not null, indexé en tête des index composites).
- Le schéma Drizzle doit encoder la machine à états Ticket par enum stricte, identique au contrat.
- SI une migration détecte un renommage ambigu, ALORS drizzle-kit strict doit demander confirmation (jamais drop+add silencieux).
- Le système doit garantir l'unicité `(queueId, number)` du numéro de ticket par file et par jour.

**Critères d'acceptation**
- [ ] `DB-001: migration up/down propre sur PostgreSQL 16 (Testcontainers)`
- [ ] `DB-001: unicité (queueId, number, day) violée → erreur contrainte`
- [ ] `DB-001: transition d'état illégale rejetée au niveau service`
- [ ] `DB-001: index composites bank_id-first sur tickets, queues, counters`

**Hors scope** : RLS (DB-002), seed (DB-003).

---

### F3 — API CŒUR (agent-api · implémente le VRAI contrat, TDD)

| ID | Story | Dépend de |
|---|---|---|
| API-001 | Auth : login, JWT 15min + refresh 7j rotation, bcrypt 12, blocage 5 tentatives/15min | DB-003 |
| API-002 | Middleware tenant : claim JWT → `SET app.current_bank_id` sur chaque requête | API-001, DB-002 |
| API-003 ★ | Cycle de vie ticket : émission (idempotente), appel, service, clôture, NO_SHOW, transfert, abandon | API-002 |
| API-004 | Moteur de file : priorités (VIP>PMR>Senior>Prioritaire>Standard), routage par compétence+langue, débordement inter-guichets, pause de file | API-003 |
| API-005 | Endpoint sync offline : batch de tickets locaux, idempotence par uuid, résolution des numéros | API-003 |
| API-006 | Événements Socket.io serveur conformes CONTRACT-002 + lock : 2 appels simultanés → un seul gagne | API-003 |
| API-007 | Gestion agents : statuts temps réel, chronomètre par ticket, alertes (inactif >10min, SLA dépassé, déconnexion avec ticket ouvert → WAITING prioritaire + alerte) | API-004, API-006 |
| API-008 | CRUD admin : banques, agences, services, guichets, horaires+fériés, RBAC 6 rôles (matrice v5 §MODULE 4) | API-002 |
| API-009 | Templates & onboarding agence : clonage config, import CSV agents, accès borne | API-008 |
| API-010 | Feedback client : note 1-5 + commentaire, anti-spam, agrégation NPS | API-003 |
| API-011 | Rate limiting routes publiques + healthchecks + endpoints supervision bornes | API-002 |

#### ★ API-003 (expansée)

**Exigences (EARS)**
- QUAND un client émet un ticket, le système doit créer le ticket en `WAITING`, retourner numéro + position + attente estimée, et émettre `ticket:created` en <500ms.
- QUAND l'émission porte un `X-Idempotency-Key` déjà vu (<24h), le système doit retourner la réponse originale sans créer de doublon.
- QUAND un agent appelle le suivant, le système doit sélectionner selon les priorités du moteur de file, passer le ticket en `CALLED`, et émettre `ticket:called` vers l'écran d'appel en <500ms.
- SI deux agents appellent simultanément, ALORS un seul doit obtenir le ticket (lock Redis), l'autre reçoit le suivant.
- SI le client ne se présente pas après N minutes (config, défaut 3), ALORS l'agent peut marquer `NO_SHOW` et le suivant est appelé.
- Le système doit calculer `waitTime` et `serviceTime` à la clôture et les persister.

**Critères d'acceptation**
- [ ] `API-003: émission → 201 + position + estimation, event <500ms`
- [ ] `API-003: rejeu même Idempotency-Key → même réponse, zéro doublon`
- [ ] `API-003: appel concurrent par 2 agents → un seul CALLED (test de course)`
- [ ] `API-003: toute transition illégale → 409 conforme au contrat`
- [ ] `API-003: NO_SHOW après timeout config → stats incrémentées`
- [ ] `API-003: Schemathesis passe sur toutes les routes tickets`

**Hors scope** : priorités/routage fin (API-004), sync offline (API-005).

---

### F4 — CLIENTS SUR MOCK (parallèle à F3 — c'est le gain API-First)

**Kiosque (agent-kiosk)** — l'interface chef-d'œuvre, design system Partie III = LA LOI

| ID | Story | Dépend de |
|---|---|---|
| KIOSK-001 | Shell Electron + mode kiosque fullscreen + i18n 4 langues + tokens design | CONTRACT-009 |
| KIOSK-002 | Écran Accueil/Langue : 4 cartes, état de file visible, timeout 30s | KIOSK-001 |
| KIOSK-003 | Écran Services : cartes icône+texte+attente temps réel, max 4 visibles, accès prioritaire ♿ | KIOSK-002 |
| KIOSK-004 | Écran Confirmation : pavé numérique natif 72px, téléphone explicitement facultatif, consentement UEMOA | KIOSK-003 |
| KIOSK-005 ★ | Le Moment Ticket : 128px, pulse brand 400ms, voix, impression, retour auto 4s | KIOSK-004 |
| KIOSK-006 | Offline-first complet : Dexie.js, numérotation locale séquentielle, badge discret, sync idempotente | KIOSK-005 |
| KIOSK-007 | États dégradés : imprimante HS, file longue (SMS mis en avant), service fermé (grisé+horaire), erreur système (message humain + alerte manager) | KIOSK-005 |
| KIOSK-008 | Synthèse vocale 4 langues + mode accessibilité (+20% textes, voix ralentie, timeout doublé) | KIOSK-005 |
| KIOSK-009 | Feedback post-service sur borne (note 1-5, commentaire vocal optionnel) | KIOSK-005 |

**Écran d'appel TV (agent-web)**

| ID | Story | Dépend de |
|---|---|---|
| TV-001 | Layout héros 180px + 3 précédents + file, contraste max, mode 16:9 TV bas de gamme | CONTRACT-009 |
| TV-002 | Flash brand 2s + double gong + annonce vocale à chaque appel, reconnexion WS → resync | TV-001 |

**Dashboard & interface agent (agent-web)**

| ID | Story | Dépend de |
|---|---|---|
| WEB-001 | Shell Next.js 15 : auth, RBAC par rôle, theming par tenant, tokens | CONTRACT-009 |
| WEB-002 | Interface agent : 3 boutons fixes, ticket 96px + chrono, raccourci Espace, utilisable sans regarder | WEB-001 |
| WEB-003 | Dashboard manager : hiérarchie en Z, TMA coloré vs SLA, file par service, grille agents, sparklines 24h, comparatif J-7, rouge réservé aux alertes | WEB-001 |
| WEB-004 | Dashboard direction réseau : classement agences vert/orange/rouge, carte, alertes | WEB-003 |
| WEB-005 | Dashboard qualité + COMEX (3 KPIs) + mode TV salle de pilotage (typo ×1.5) | WEB-004 |
| WEB-006 | Console admin : config banque/agence, services, SLA, templates SMS, seuils, onboarding <2h | WEB-001 |

**Mobile client (agent-mobile)**

| ID | Story | Dépend de |
|---|---|---|
| MOB-001 | Shell Expo : navigation, i18n, tokens, auth légère par téléphone | CONTRACT-009 |
| MOB-002 | Prise de ticket à distance — même parcours 3 étapes que le kiosque | MOB-001 |
| MOB-003 | Ticket vivant : carte plein écran, position temps réel, Live Activity iOS / notif persistante Android | MOB-002 |
| MOB-004 | Push "plus que 2 personnes" + offline MMKV + sync queue | MOB-003 |
| MOB-005 | Feedback post-service + historique de tickets | MOB-003 |

#### ★ KIOSK-005 (expansée)

**Exigences (EARS)**
- QUAND le ticket est émis, l'écran entier doit devenir le ticket : numéro en 128px Display couleur brand, position et attente en hiérarchie claire, pulse brand unique de 400ms.
- QUAND le Moment Ticket s'affiche, la synthèse vocale doit annoncer numéro + position + attente dans la langue choisie.
- SI l'impression réussit, le système doit afficher « Votre ticket s'imprime… » ; SI le téléphone a été saisi, « SMS envoyé au 07 •• •• •• 47 » (masqué).
- Le système doit revenir à l'accueil automatiquement après 4 secondes (8 en mode accessibilité).
- LÀ OÙ `prefers-reduced-motion` est actif, le pulse doit être remplacé par une apparition statique.

**Critères d'acceptation**
- [ ] `KIOSK-005: numéro rendu à 128px, token brand, dans les 4 langues sans débordement`
- [ ] `KIOSK-005: annonce vocale déclenchée dans la langue de session`
- [ ] `KIOSK-005: retour accueil à 4s (8s accessibilité)`
- [ ] `KIOSK-005: reduced-motion → zéro animation, contenu identique`
- [ ] `KIOSK-005: screenshot de référence commité (régression visuelle ×4 langues)`

**Hors scope** : logique offline (KIOSK-006), impression matérielle réelle (driver — story dédiée à l'intégration matérielle pilote).

---

### F5 — BASCULE TEMPS RÉEL (mock → backend réel)

| ID | Story | Agent | Dépend de |
|---|---|---|---|
| RT-001 | Bascule kiosque/web/mobile/TV du mock vers l'API réelle (variable d'env) + vérification Schemathesis complète | orchestrateur + agents concernés | F3 DONE, F4 DONE |
| RT-002 | Suite realtime-guarantees : ticket:called <500ms bout-en-bout, reconnexion WS resync, course de 2 agents | agent-api + agent-web | RT-001 |
| RT-003 | E2E Playwright parcours complets : client borne → appel TV → service agent → feedback, avec coupure réseau simulée mi-parcours | direct | RT-002 |

### F6 — NOTIFICATIONS & JOBS (agent-api)

| ID | Story | Dépend de |
|---|---|---|
| NOTIF-001 | Infrastructure BullMQ : queues, retry, dead-letter, idempotence d'envoi | API-003 |
| NOTIF-002 | SMS Africa's Talking : confirmation, "vous êtes 3e", "vous êtes le suivant", templates par banque, opt-in strict | NOTIF-001, DB-005 |
| NOTIF-003 | WhatsApp Business : prise de ticket par message + avancement | NOTIF-002 |
| NOTIF-004 | Email Resend + React Email : rapports, alertes manager | NOTIF-001 |
| NOTIF-005 | QR code agence → PWA ticket mobile navigateur (sans app) | CONTRACT-003, API-003 |

### F7 — REPORTING (agent-api + agent-web)

| ID | Story | Dépend de |
|---|---|---|
| REP-001 | Moteur d'agrégats : TMA, TMT, TTS, abandon, taux SLA, NPS, occupation — calculs exacts testés (suite sla-engine) | DB-006, API-003 |
| REP-002 | Rapports auto planifiés : journalier 18h directeur (PDF email), hebdo lundi 7h réseau, mensuel qualité + COMEX 1 page | REP-001, NOTIF-004 |
| REP-003 | Exports PDF / Excel / API JSON + benchmarking inter-agences | REP-001 |

### F8 — ADMIN & THEMING (agent-api + agent-web)

| ID | Story | Dépend de |
|---|---|---|
| ADM-001 | Theming par tenant : logo, brand avec contraste auto-corrigé ≥4.5:1, messages d'accueil — habillage jamais structure | WEB-001, API-008 |
| ADM-002 | Onboarding nouvelle agence <2h : template, clonage, génération accès borne + QR d'installation | API-009, WEB-006 |
| ADM-003 | Supervision bornes : statut ping temps réel de toutes les bornes, alertes borne muette | API-011, WEB-004 |

### F9 — SÉCURITÉ RENFORCÉE & CHARGE

| ID | Story | Agent | Dépend de |
|---|---|---|---|
| SEC-001 | Audit trail complet branché sur toutes les mutations (qui/quoi/quand/IP), immuable, écran Auditor | agent-api + agent-web | DB-004, F3 |
| SEC-002 | Campagne tenant-isolation exhaustive : chaque table, chaque route, injections | agent-database | F3 DONE |
| SEC-003 | PRA : backups horaires S3, restauration testée (RPO 1h, RTO 15min), runbook | direct | F3 |
| SEC-004 | k6 charge : 100 tickets/min/agence × 50 agences, Socket.io p95 <500ms, PgBouncer tuning | direct | RT-002 |
| SEC-005 | Stryker mutation ≥60% sur moteur de file + sla-engine | direct | REP-001 |

### F10 — IA & PRÉDICTION (agent-api, prérequis : données réelles de production)

| ID | Story | Dépend de |
|---|---|---|
| IA-001 | Pipeline features : historique affluence par agence/heure/jour + calendrier CI (fins de mois, paie FP, fêtes) | REP-001, DB-007 |
| IA-002 | Prédiction affluence + recommandation staffing ("ouvrir 2 guichets à 10h30") | IA-001 |
| IA-003 | Détection anomalies : file bloquée, agent inactif, SLA systématique | IA-001 |
| IA-004 | NLP feedbacks FR + langues locales, scoring qualité auto par agence/agent | API-010, IA-001 |
| IA-005 | Surfaces IA : insights dashboard direction + COMEX prédictif | IA-002..004, WEB-005 |

### F11 — SUPERVISION RÉSEAU MULTI-BANQUES

| ID | Story | Agent | Dépend de |
|---|---|---|---|
| NET-001 | Console Super Admin cross-tenant (isolation stricte en lecture) | agent-api + agent-web | ADM-003, SEC-002 |
| NET-002 | Mise à jour centralisée des bornes (1 déploiement → toutes agences) + canary | direct | ADM-003 |
| NET-003 | Monitoring production : Grafana, Sentry, alertes CPU>80%/mem>85%/err>1% | direct | SEC-004 |

---

## 4. RÈGLES D'EXÉCUTION DU CATALOGUE

1. **Expansion obligatoire** : aucune story du catalogue n'est dispatchée sans être d'abord expansée au gabarit §2 par la Boucle 1 (Fable 5 + 3 critiques). Les ★ montrent le niveau attendu.
2. **CONTRACT toujours devant** : F1 doit être DONE (contrat validé humainement + mock généré) avant tout dispatch F3/F4.
3. **F4 n'attend jamais F3** : les clients codent sur mock — c'est le contrat qui synchronise, pas le calendrier.
4. **Une story = une couche = un agent.** Toute story qui violerait ça est redécoupée à l'expansion.
5. **DESIGN-gates** : les écrans majeurs (KIOSK-002..005, TV-001, WEB-002/003) passent par une validation wireframe humaine avant implémentation.
6. **Critères de sortie produit** (remplacent les critères MVP) : TMA −30% mesuré sur pilote · uptime ≥99,9% · NPS ≥75 · onboarding agence <2h · tenant-isolation 100% PASS · k6 PASS · mutation ≥60% cœur.
