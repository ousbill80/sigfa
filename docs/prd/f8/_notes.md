# F8 — ADMIN & THEMING · Notes d'expansion (Boucle 1)

> Compagnon des stories `ADM-001`..`ADM-003`. Questions ouvertes, risques, DESIGN-gates à programmer, ajouts de contrat requis (API-First — amont).

---

## 1. Découpage appliqué (Loi 4 — une story = une couche = un agent)

Chaque ADM du catalogue touche **API + web** → scindée en sous-stories par couche :

| Catalogue | Sous-stories | Agents |
|---|---|---|
| ADM-001 | ADM-001a (API theme + contraste serveur) · ADM-001b (web injection + éditeur) | agent-api · agent-web |
| ADM-002 | ADM-002a (API clone + accès borne/QR) · ADM-002b (web Stepper chronométré) | agent-api · agent-web |
| ADM-003 | ADM-003a (API heartbeat + état + alerte) · ADM-003b (web supervision) | agent-api · agent-web |

Ordre de dispatch : **a (API) avant b (web)** pour chaque paire — mais b code sur le mock Prism du contrat étendu, donc a et b peuvent démarrer en parallèle dès le contrat mis à jour.

---

## 2. Ajouts de contrat requis (API-First — à faire EN AMONT, agent-contract)

Ces ajouts doivent atterrir dans `admin.yaml` / `events` (CONTRACT-005 / CONTRACT-002) **avant** dispatch F8. Additifs, viser **oasdiff NON-BREAKING**.

**Theming (ADM-001)**
- `GET/PATCH /api/v1/banks/{bankId}/theme` — schéma `Theme { brand, brandStrong, brandSoft, brandContrast, logoUrl?, welcomeMessages{fr,en}, corrected?, brandRequested? }`.
- `POST /api/v1/banks/{bankId}/theme/logo` — upload (multipart), réponse `{ logoUrl }`.
- `GET /public/banks/{bankId}/theme` — projection publique (zéro PII).
- Codes : `INVALID_BRAND` (422), `UNKNOWN_FIELD` (422), `INVALID_LOGO` (422).

**Onboarding / bornes (ADM-002)**
- `GET /api/v1/banks/{bankId}/agency-templates`.
- `POST /api/v1/banks/{bankId}/agencies:clone` — `{ name, templateId?|sourceAgencyId?, overrides? }` → `{ agency, onboardingId }`.
- `POST /api/v1/agencies/{agencyId}/kiosks:provision` → `{ kioskId, enrollmentToken, enrollmentQrUrl, expiresAt }`.
- `GET /api/v1/agencies/{agencyId}/onboarding/{onboardingId}` — étapes + timestamps.
- Endpoint d'échange d'enrôlement borne (token → credentials borne) — aligné sur le durcissement token borne/TV déjà clos.
- Codes : `CLONE_SOURCE_REQUIRED` (422), `KIOSK_ENROLLMENT_INVALID` (401/403 opaque).

**Supervision (ADM-003)**
- `POST /api/v1/kiosks/{kioskId}/heartbeat` — `{ ts, fw?, printerOk?, queueDepth? }` → 204.
- `GET /api/v1/agencies/{agencyId}/kiosks/status` et `GET /api/v1/banks/{bankId}/kiosks/status`.
- Enum `KioskStatus = ONLINE | DEGRADED | SILENT | NEVER_SEEN`.
- Config par agence : `heartbeatIntervalSec` (30), `silentThresholdSec` (90).
- **CONTRACT-002 (Socket.io)** : nouveaux événements `kiosk:silent`, `kiosk:recovered`, éventuellement `kiosk:status` (agrégat) — additifs.

→ Confirmer que ces ajouts passent le job oasdiff NON-BREAKING (aucun champ requis nouveau sur l'existant, aucun retrait).

---

## 3. Questions ouvertes (à arbitrer avant/pendant dispatch)

1. **Multi-logo ?** Un seul `logoUrl` (proposé, hypothèse par défaut) ou variantes (logo clair pour kiosque `--night`, logo sombre pour web `--paper`, favicon) ? Impact ADM-001a schéma + ADM-001b upload. **Par défaut : mono-logo** tant que non tranché — multi-logo marqué hors scope dans ADM-001.
2. **Messages d'accueil i18n par tenant** — confirmé : **FR + EN uniquement** (mémoire « langues FR/EN only » ; Dioula/Baoulé retirés). Question résiduelle : longueur max / fallback si EN vide → afficher FR ? (proposé : fallback FR).
3. **`brandContrast` — palette autorisée** : se limite-t-on à `{ --ink, --ink-inverse }` comme candidats de texte sur `brand` (proposé, garde le langage SIGFA cohérent), ou autorise-t-on un blanc/noir calculé libre ? Impact déterminisme du calcul.
4. **Stratégie d'assombrissement de `brand`** hors-contraste : pas fixes (ex. −5 % luminance itératif) vs projection OKLCH vers cible de luminance. À figer dans l'utilitaire `@sigfa/ui` (source unique serveur+front).
5. **Seuil « muette » global ou par agence ?** Proposé : défaut global (90 s) surchargé par agence. Confirmer qu'aucun besoin de surcharge par borne individuelle.
6. **Canal d'alerte borne muette** : réutilise le canal alertes manager existant (NOTIF / dashboard) — confirmer qu'aucune escalade SMS/email dédiée n'est attendue en F8 (sinon dépend NOTIF-002/004, à déclarer).
7. **Débounce alerte** : une alerte par épisode de silence — confirmer la fenêtre anti-flapping (borne qui oscille ONLINE/SILENT) et si un `DEGRADED` prolongé doit aussi alerter (proposé : non, seul `SILENT` alerte).
8. **QR d'installation** : encode l'URL d'enrôlement (proposé) — jamais le token en clair. Confirmer format/rotation et affichage imprimable.

---

## 4. Risques

- **Divergence contraste front/serveur** : si l'utilitaire de contraste n'est PAS partagé (`@sigfa/ui`), la preview web et la valeur persistée serveur peuvent diverger → confusion utilisateur. **Mitigation : un seul utilitaire, source unique, consommé des deux côtés** (exigé dans ADM-001a/b).
- **Fuite de structure via theming** : tentation d'ajouter « juste un token de plus » (police, rayon) par tenant. **Garde-fou : 422 UNKNOWN_FIELD + test d'absence de commande layout dans l'éditeur.** Loi 5 v1.
- **Token d'enrôlement borne** : risque sécurité si longue durée / réutilisable / loggé. **Mitigation : usage unique, TTL court, opaque, jamais loggé** — cohérent avec le durcissement token borne/TV déjà clos.
- **Tempête d'alertes** (coupure réseau agence → toutes bornes muettes d'un coup) : débounce par borne + agrégation par agence côté écran nécessaires.
- **État figé vs calculé** : un statut borne persisté deviendrait périmé ; d'où calcul à la lecture (ADM-003a) — attention à la charge sur `.../status` réseau (mémoïsation / index `bank_id`).
- **< 2h non tenu** si le clonage ne pré-remplit pas assez : le chrono d'onboarding rend le dépassement visible mais ne le corrige pas — surveiller sur pilote (critère de sortie PRD).

---

## 5. DESIGN-gates à programmer (GO wireframe/capture humain AVANT implémentation)

Trois écrans majeurs F8 requièrent une revue visuelle (`design-reviewer` sur capture réelle, Design System v2 §6) :

| Écran | Story | Points de vigilance |
|---|---|---|
| **Console theming** (éditeur `--brand` + preview + contraste) | ADM-001b | preview fidèle bouton/badge/en-tête ; affichage clair du contraste et de la correction ; ne jamais suggérer d'option de structure |
| **Parcours onboarding (Stepper) + QR d'installation** | ADM-002b | chrono non anxiogène ; QR lisible/imprimable ; reprise de parcours claire |
| **Supervision bornes** (vue agence + réseau) | ADM-003b | calme malgré densité ; `SILENT` en pastille/pictogramme danger jamais fond plein ; hiérarchie « rouge = alerte uniquement » |

→ L'orchestrateur ne dispatche l'implémentation web qu'après GO humain sur ces trois écrans (Gate de story §4 CLAUDE.md).

---

## 6. Conformité

- **Hors scope définitif respecté** : aucun CRM / Core Banking / Mobile Money / biométrie ; theming = habillage jamais structure ; pas d'app mobile cliente ; FR/EN seulement.
- **API-First** : toutes les routes theming/onboarding/supervision listées §2 doivent exister au contrat avant dispatch (frontends sur mock Prism).
- **Aucune écriture `apps/`/`packages/`** dans cette expansion (docs seulement). **Aucune commande git.**
