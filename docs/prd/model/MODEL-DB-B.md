# MODEL-DB-B : Schéma conseiller — flag sur `users` + `tickets.target_manager_id`

**Module** : MODÈLE (Phase B) · **Agent** : agent-database · **Dépend de** : CONTRACT-B (DONE), DB-A (DONE) · **Statut** : TODO

**Révision** : v2 — arbitrage `_arbitrage.md` (D5, D6). Additif. Conforme à LA LOI (CONTRACT-B).

## Exigences (EARS)
- **Flag conseiller sur `users`** : ajouter `is_relationship_manager` bool NOT NULL default `false`, `display_name` text NULLABLE, `photo_url` text NULLABLE. Additif (colonnes nullable/défaut) — aucune migration destructive. `users` est déjà sous RLS (avec exception SUPER_ADMIN) → les nouvelles colonnes héritent des policies existantes (pas de nouvelle policy).
- **`tickets.target_manager_id`** uuid **NULLABLE** FK→users (RESTRICT) + index `(target_manager_id)` — cible d'un ticket « conseiller » (D6 : file mono-agent, logique en API-B). Additif ; ne casse pas `service_id`/`operation_id`.
- **PAS de nouvelle table file** (D6) : la file conseiller = filtre `target_manager_id` sur les tickets de l'agence (queue logique). Aucune structure supplémentaire.
- **Migration additive up/down** (nouvelle migration à la suite de 0009) testée (apply/rollback/idempotence).
- **Seed** : marque ≥2 agents seed comme conseillers (`is_relationship_manager=true` + `display_name` réaliste, `photo_url` optionnel) — démontre la liste publique.
- **Dette fixtures inline** : les fixtures DDL `users`/`tickets` inline des tests api gagnent les nouvelles colonnes (couture MODEL-API-B — documente la liste exacte, NE modifie PAS `apps/api` depuis cette story).

## Critères d'acceptation
- [ ] `MODEL-DB-B: users gagne is_relationship_manager/display_name/photo_url (additif) ; tickets.target_manager_id NULLABLE FK users RESTRICT + index — schéma Drizzle + migration up/down`
- [ ] `MODEL-DB-B: RLS users inchangée (nouvelles colonnes sous policy existante) ; tenant-isolation toujours PASS`
- [ ] `MODEL-DB-B: migration additive idempotente up/down testée ; seed marque ≥2 conseillers`
- [ ] `MODEL-DB-B: tests database Testcontainers verts, zéro régression F2/DB-A ; liste des fixtures inline apps/api à aligner (couture API-B) documentée`

## Hors scope
Routage file conseiller (API-B, D6 : priorité absolue) · contrat (CONTRACT-B DONE) · UI (KIOSK-B/WEB-B) · fixtures apps/api (couture, API-B).
