# MODEL-CONTRACT-A : Contrat — Opérations (additif, non-breaking) + création ticket par opération

**Module** : MODÈLE (Phase A) · **Agent** : agent-contract · **Dépend de** : contrat F1 en vigueur · **Statut** : TODO

**Révision** : v2 — arbitrage `docs/prd/model/_arbitrage.md` (D1, D2, D4, D8, D10). Racine du DAG de la vague MODÈLE (LA LOI d'abord).

## Exigences (EARS)
- **UBIQUITAIRE** : le contrat gagne l'entité **Operation** (enfant d'un service) : `{ id, serviceId, code (`^[A-Z0-9]{2,6}$`), name, slaMinutes? (nullable → hérite du service), displayOrder, isActive, iconKey? }`. **Aucune notion de « priorité » sur l'opération** (la priorité reste l'enum porteur `TicketPriority` du ticket — D4).
- **CRUD admin** (schémas + chemins, YAML `admin.yaml`/`core.yaml` selon cohérence) : `GET/POST /services/{serviceId}/operations`, `GET/PATCH/DELETE /operations/{id}` — `x-required-role` aligné sur la config services (BANK_ADMIN / AGENCY_DIRECTOR sur son agence), `x-tenant-scope: agency`, `additionalProperties:false`, codes d'erreur EXACTS (réutiliser `SERVICE_NOT_FOUND`, ajouter `OPERATION_NOT_FOUND`, `OPERATION_CODE_DUPLICATE`).
- **Liste publique borne** : `GET /public/agencies/{agencyId}/operations?serviceId=` (role NONE) → opérations actives d'un service pour l'affichage borne (`{ id, code, name, slaMinutes(résolu), iconKey? }` — SLA **résolu** opération?.service exposé pour l'estimation d'attente).
- **Création ticket par opération (RÉTROCOMPAT — D1)** : les corps de création de ticket (`CreateTicketRequest` core, `PublicTicketRequest`/base public) gagnent **`operationId` OPTIONNEL** ; **`serviceId` reste `required` inchangé** (zéro breaking). Règle documentée : si `operationId` fourni → le serveur dérive `serviceId = operation.serviceId` (et si `serviceId` aussi fourni et incohérent → 422 `SERVICE_OPERATION_MISMATCH`) ; si `operationId` absent → `serviceId` utilisé tel quel. La réponse ticket gagne `operationId?` (nullable, additif).
- **anormal** : `operationId` inconnu/inactif/hors agence → 404 `OPERATION_NOT_FOUND` (opaque sur les routes publiques).
- Tests structurels du contrat (TDD) : schémas Zod des événements NON impactés ; **oasdiff = NON-BREAKING** (job Contract Diff C4 vert — `operationId` additif optionnel, `serviceId` intact).

## Critères d'acceptation
- [ ] `MODEL-CONTRACT-A: Operation schema (code regex, slaMinutes nullable, PAS de priority) + CRUD admin + liste publique — bundlés, types générés`
- [ ] `MODEL-CONTRACT-A: CreateTicket/PublicTicket gagnent operationId OPTIONNEL, serviceId reste required — oasdiff NON-BREAKING (job C4 vert)`
- [ ] `MODEL-CONTRACT-A: règle de résolution documentée (operationId→serviceId dérivé ; mismatch→422 SERVICE_OPERATION_MISMATCH) + réponse ticket gagne operationId?`
- [ ] `MODEL-CONTRACT-A: codes OPERATION_NOT_FOUND / OPERATION_CODE_DUPLICATE / SERVICE_OPERATION_MISMATCH ajoutés ; 219+ tests contrats verts, zéro régression`
- [ ] `MODEL-CONTRACT-A: client typé + mock Prism couvrent les nouvelles routes (Schemathesis/prism inchangés verts)`

## Hors scope
Schéma DB (MODEL-DB-A) · logique de résolution serveur (MODEL-API-A) · conseillers (Phase B) · rendez-vous (ANNULÉ — pas d'app mobile cliente) · UI (MODEL-KIOSK-A/WEB-A).
