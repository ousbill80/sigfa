# MODEL-CONTRACT-B : Contrat — Conseillers (liste publique nominative) + ticket ciblant un conseiller

**Module** : MODÈLE (Phase B) · **Agent** : agent-contract · **Dépend de** : CONTRACT-A (DONE) · **Statut** : TODO

**Révision** : v2 — arbitrage `_arbitrage.md` (D5, D6). Additif, non-breaking (comme CONTRACT-A). Le parcours conseiller = **borne + web uniquement** (pas d'app mobile cliente — cf. décision PO).

## Exigences (EARS)
- **Flag conseiller sur l'utilisateur** : le schéma `User`/config admin gagne `isRelationshipManager` (bool) + `displayName` (public) + `photoUrl?` (optionnel). CRUD admin : marquer/démarquer un agent conseiller (via le PATCH profil agent existant ou une route dédiée alignée RBAC AGENCY_DIRECTOR+).
- **Liste publique NOMINATIVE (D5 — zéro PII, pas de CRM)** : `GET /public/agencies/{agencyId}/relationship-managers` (role NONE) → **UNIQUEMENT `{ id, displayName, photoUrl? }`** des agents `isRelationshipManager AND is_active AND deleted_at IS NULL`. **JAMAIS** d'email, rôle, téléphone, ni lien client↔conseiller (respecte le hors-scope « CRM bancaire » — CLAUDE.md §5). Le client choisit librement dans la liste.
- **Ticket ciblant un conseiller (D6)** : les corps de création de ticket gagnent **`targetManagerId` OPTIONNEL** (uuid, additif). QUAND fourni → le ticket rejoint la **file personnelle** de ce conseiller (routage mono-agent — logique en API-B). `serviceId`/`operationId` restent gérés comme en Phase A (un ticket conseiller peut aussi porter une opération, ou non — à préciser : conseiller = file perso prioritaire, l'opération reste indicative). La réponse ticket gagne `targetManagerId?` (nullable).
- **anormal** : `targetManagerId` inconnu / non-conseiller / hors agence → 404 opaque `RELATIONSHIP_MANAGER_NOT_FOUND`.
- Tests structurels contrat (TDD) ; **oasdiff NON-BREAKING** (job C4 vert — `isRelationshipManager`/`displayName`/`photoUrl` et `targetManagerId` additifs optionnels ; aucun retrait/required nouveau sur l'existant).

## Critères d'acceptation
- [ ] `MODEL-CONTRACT-B: User gagne isRelationshipManager/displayName/photoUrl (admin) — additif`
- [ ] `MODEL-CONTRACT-B: GET /public/.../relationship-managers expose UNIQUEMENT id/displayName/photoUrl (zéro PII) — schéma bundlé`
- [ ] `MODEL-CONTRACT-B: création ticket gagne targetManagerId OPTIONNEL + réponse targetManagerId? — oasdiff NON-BREAKING (C4 vert)`
- [ ] `MODEL-CONTRACT-B: code RELATIONSHIP_MANAGER_NOT_FOUND ajouté ; tests contrats verts, zéro régression`

## Hors scope
Schéma DB (DB-B) · routage file conseiller (API-B, arbitrage D6 : file perso = priorité absolue) · UI (KIOSK-B/WEB-B) · rendez-vous/mobile (ANNULÉ) · lien client↔conseiller attitré (INTERDIT — CRM hors scope).
