# VAGUE MODÈLE — Services · Opérations · Conseillers (Boucle 1, draft orchestrateur)

> Enrichissement du modèle métier suite au retour PO (2026-07-12) : une agence a **plusieurs SERVICES**, chacun regroupant des **OPÉRATIONS**, et le client peut demander **un conseiller nommé** (borne + mobile). Le modèle plat actuel (`services` = Dépôt/Retrait…) est insuffisant.

**Révision** : v1 (à critiquer). En attente GO PO avant Boucle 2.

## 1. Modèle de données cible

### Service (existant — famille/département)
`services` : famille (Caisse, Crédit, Épargne, Service clientèle, Change…). Garde `code`, `name`, `display_order`, `agency_id`. Porte le **SLA/priorité PAR DÉFAUT** de ses opérations. Compétence agent/guichet définie au niveau service.

### Opération (NOUVEAU — enfant d'un service)
`operations` : l'acte précis. Colonnes proposées : `id`, `service_id` FK, `agency_id` (dénormalisé pour RLS/scope), `code` (unique par service), `name`, `sla_minutes` NULLABLE (→ hérite du service si null), `priority` NULLABLE (→ hérite), `display_order`, `is_active`, `icon_key` (mappe vers le jeu d'icônes SVG). **Le ticket référence une OPÉRATION** (`operation_id`) et en dérive le service. Migration : les « services » plats actuels deviennent des opérations sous un service par défaut (script de migration).

### Conseiller / Chargé de clientèle (NOUVEAU — attribut sur users)
Un agent peut être **conseiller** : `users.is_relationship_manager` (bool) + `display_name` public + `photo_url?`. Les conseillers d'une agence sont **listables** (nom, éventuellement spécialité). Un client peut demander un conseiller précis.

### File par conseiller
Un ticket peut cibler un conseiller (`target_manager_id`) → rejoint la **file personnelle** de ce conseiller (routé UNIQUEMENT à lui), au lieu d'une file de service. Le moteur de file (API-004) gère les deux : file de service (routage par compétence) et file conseiller (mono-agent).

### Rendez-vous (NOUVEAU — mobile à distance)
`appointments` : `id`, `conseiller_id`, `agency_id`, client (`phone` chiffré / `tracking`), `slot_start`/`slot_end`, `status` (`requested`/`confirmed`/`cancelled`/`done`), `created_at`. Basé sur les **disponibilités** du conseiller (créneaux). Confirmation + rappel (rappel réel = F6).

## 2. Parcours utilisateurs

### Borne (en agence) — 2 chemins (refonte de l'écran services v2, grille déjà en place)
1. **Une opération** : « Que souhaitez-vous faire ? » → choisir le **SERVICE** (grille) → choisir l'**OPÉRATION** (grille) → ticket walk-in (file de service).
2. **Voir mon conseiller** : → liste des **conseillers** de l'agence (nom + photo) → ticket walk-in pour CE conseiller (sa file, maintenant).

### Mobile — 2 chemins
1. **Prendre un ticket à distance** (opération) : service → opération → ticket (suivi live existant).
2. **Rendez-vous avec mon conseiller** : choisir le conseiller → **créneau disponible** → réserver → confirmation (rappel F6).

## 3. Extension du contrat (LA LOI)
- `operations` : CRUD admin (`/services/{id}/operations`, `/operations/{id}`) + liste publique borne (`GET /public/agencies/{id}/operations?serviceId=`).
- `conseillers` : `GET /public/agencies/{id}/relationship-managers` (liste publique nom/photo/dispo) + flag admin sur users.
- Création ticket : `operation_id` (remplace/complète `service_id`) + `target_manager_id?` (chemin conseiller). Rétrocompat : `service_id` déduit de l'opération.
- `appointments` : `POST /public/appointments` (mobile), `GET/DELETE /appointments/{id}`, disponibilités `GET /public/relationship-managers/{id}/availability`.
- SLA/priorité résolus : **opération si définie, sinon service** (règle unique documentée, testée).

## 4. Impact API-004 (moteur de file)
- La position/estimation utilise le SLA résolu (opération→service). `selectNextPriority` inchangé (VIP>PMR>…) mais la priorité vient du niveau résolu.
- Nouvelle stratégie **file conseiller** : `TicketSelector` mono-agent (tickets `target_manager_id = X` servis par X uniquement). Un agent conseiller sert sa file perso + éventuellement la file de service (à trancher : priorité entre les deux).

## 5. Phasage proposé (à valider en arbitrage)
- **Phase A — Services→Opérations** : schéma `operations` + migration + contrat + API routing 2 niveaux (SLA résolu) + borne 2 écrans (service→opération) + admin config opérations. (Cœur du besoin « plusieurs services + opérations ».)
- **Phase B — Conseillers walk-in** : flag conseiller + file par conseiller (moteur) + borne « voir mon conseiller » + liste publique + admin.
- **Phase C — Rendez-vous mobile** : `appointments` + disponibilités + mobile booking + confirmation (rappel = F6). Feature la plus lourde → dernière.

## 6. Stories (à expanser en EARS après GO du cadre)
| ID | Story | Phase |
|---|---|---|
| MODEL-CONTRACT-A | Contrat : operations CRUD + liste publique + ticket via operation_id (SLA résolu) | A |
| MODEL-DB-A | Schéma `operations` + migration (services plats → opérations) + RLS | A |
| MODEL-API-A | Routing 2 niveaux (SLA/priorité opération→service), création ticket par opération | A |
| MODEL-KIOSK-A | Borne : service → opération (2 écrans en grille v2) | A |
| MODEL-WEB-A | Admin : CRUD opérations sous service | A |
| MODEL-CONTRACT-B | Contrat : conseillers (flag + liste publique) + target_manager_id | B |
| MODEL-DB-B | Schéma conseiller (users flag + file perso) | B |
| MODEL-API-B | Moteur : file par conseiller (mono-agent) + arbitrage file service/conseiller | B |
| MODEL-KIOSK-B | Borne : « voir mon conseiller » | B |
| MODEL-WEB-B | Admin : marquer un agent conseiller | B |
| MODEL-CONTRACT-C | Contrat : appointments + disponibilités | C |
| MODEL-DB-C | Schéma `appointments` + disponibilités | C |
| MODEL-API-C | API rendez-vous (créneaux, réservation, annulation) | C |
| MODEL-MOBILE-C | Mobile : rendez-vous conseiller (créneau + confirmation) | C |
| MODEL-WEB-C | Web : agenda conseiller (voir ses RDV) | C |

## Questions ouvertes (à trancher — critiques + arbitrage)
- **Identification du conseiller** : le client choisit dans une liste nominative publique (nom + photo) ? recherche ? ou faut-il s'authentifier (numéro de compte/téléphone) pour voir SON conseiller attitré ? (défaut proposé : liste publique nominative en agence ; sur mobile, rattachement possible via le numéro.)
- **Arbitrage file service vs file conseiller** quand un conseiller sert les deux (priorité ? alternance ?).
- **Créneaux de rendez-vous** : granularité, disponibilités saisies par le conseiller/manager, capacité, no-show.
- **Migration** des données existantes (services plats → 1 service générique + opérations) sans casser F2/F3.
- **Rétrocompat contrat** : `service_id` sur les tickets existants — le rendre dérivé de `operation_id` sans breaking change (oasdiff).
