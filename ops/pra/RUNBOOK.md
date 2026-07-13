# RUNBOOK PRA — SIGFA (SEC-003)

> Plan de Reprise d'Activité de PostgreSQL 16 (source de vérité SIGFA).
> **Cibles verrouillées : RPO ≤ 60 min · RTO ≤ 15 min.**
> Ce runbook est **exécutable** : la mécanique (dump → chiffrement → stockage objet → restauration → vérification d'intégrité) est prouvée EN CI par le game day `apps/api/src/pra/gameday-restore.integration.test.ts` sur stockage **MOCK** (aucun réseau réel). La mesure RPO/RTO **à taille réelle** est **GATED infra** (cf. §7).

---

## 0. En un coup d'œil

| Élément | Valeur |
|---|---|
| Base protégée | PostgreSQL 16 (SIGFA) |
| Cadence backup | **horaire** (RPO ≤ 60 min) + 1 point quotidien |
| Chiffrement | **AES-256-GCM** au repos (SSE application) — clé `BACKUP_ENCRYPTION_KEY` |
| Intégrité | checksum **SHA-256** de l'enveloppe chiffrée, vérifié après push ET avant restore |
| Stockage objet | **Cloudflare R2** (S3-compatible, déjà en place pour les logos — décision QO-2) derrière l'interface `BackupStorage` |
| Rétention | horaire **≥ 48 h** glissantes · quotidien **≥ 30 j** (paramétrable, cf. `retention.json`) |
| Cible RTO | **≤ 15 min** du déclenchement à la base prête (health `UP`) |
| Cible RPO | **≤ 60 min** entre le dernier backup valide et le sinistre |

---

## 1. Architecture (mécanique livrée)

```
PostgreSQL 16 ──pg_dump -Fc──▶ dump binaire
                                   │
                        encryptBackup (AES-256-GCM)   ← BACKUP_ENCRYPTION_KEY
                                   │
                        checksum SHA-256 (enveloppe)
                                   │
                        BackupStorage.put(key, envelope, checksum)   ← R2 (prod) / Mock (CI)
                                   │
                        VÉRIFICATION post-push : head() → présence + taille>0 + checksum concordant
                                   │
                        (échec ⇒ ALERTE ops + échec visible : « le silence n'est pas un succès »)
```

Modules (périmètre `apps/api/src/pra/`) :
- `backup-storage.ts` — **interface** `BackupStorage` (contrat S3-compatible, aucun SDK cloud fuité).
- `mock-backup-storage.ts` — adaptateur **mock en mémoire** (CI / game day, zéro réseau).
- `backup-cipher.ts` — AES-256-GCM + checksum SHA-256 (réutilise le pattern `lib/phone-cipher.ts`).
- `backup-config.ts` — cibles RPO/RTO + politique de rétention paramétrable.
- `backup-service.ts` — orchestration backup vérifié / restauration / rétention.

> L'adaptateur **R2 réel** (SigV4, cf. `apps/api/src/lib/r2-presign.ts` déjà maîtrisé) est un artefact de **déploiement GATED infra** : il implémente la même interface `BackupStorage` et remplace le mock en production. Il n'est PAS en CI (aucune dépendance réseau réelle dans les tests).

---

## 2. Pré-requis (avant toute restauration)

1. Accès au stockage objet R2 (identifiants `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`).
2. **Clé de déchiffrement** `BACKUP_ENCRYPTION_KEY` (64 caractères hex) — voir §6 Custody.
3. Binaires `pg_dump` / `pg_restore` (PostgreSQL 16 client) sur la machine d'opération.
4. Une instance PostgreSQL 16 cible **vide** et joignable (base neuve).
5. Un chronomètre (le RTO se mesure du **déclenchement** à la base **prête aux requêtes**).

---

## 3. Procédure de restauration (pas-à-pas)

> ⏱️ **Démarrer le chronomètre RTO ICI.**

### Étape 1 — Sélectionner le dernier backup valide
- Lister le préfixe `backups/hourly/` (trié par date). Prendre le **plus récent**.
- Vérifier son **checksum SHA-256** contre celui stocké (`head`). **Divergence ⇒ point corrompu** → passer au point valide précédent (§4, RPO dégradé).

### Étape 2 — Télécharger + déchiffrer
- `BackupStorage.get(key)` → enveloppe chiffrée.
- Re-vérifier le checksum de l'enveloppe téléchargée (intégrité au transit).
- `decryptBackup(envelope, BACKUP_ENCRYPTION_KEY)` → dump `-Fc` en clair.
  - Échec de déchiffrement = clé erronée **ou** intégrité rompue → NE PAS restaurer, escalader (§8).

### Étape 3 — Restaurer dans une base neuve
```sh
createdb -U sigfa sigfa_restored
pg_restore -U sigfa -d sigfa_restored /chemin/vers/dump.decrypted
```

### Étape 4 — Vérifier l'intégrité (obligatoire avant bascule)
- Comptes de lignes par table sensible (`banks`, `tickets`, …) cohérents avec l'attendu.
- Contraintes présentes (PK/UNIQUE/CHECK/FK) — tester une réinsertion en doublon (doit échouer).
- Requête de contrôle par table sensible.
- **Le téléphone reste chiffré** (DB-008) dans les données restaurées : aucune PII en clair (le backup n'est pas un canal d'exfiltration).

### Étape 5 — Basculer + health check
- Repointer l'application sur `sigfa_restored`, vérifier `GET /health` → `UP`.
> ⏱️ **Arrêter le chronomètre RTO ICI.** Objectif : **≤ 15 min**. Dépassement ⇒ incident RTO, §8.

---

## 4. Backup dégradé (dernier point corrompu/absent)

Si le backup le plus récent est **corrompu** (checksum divergent) ou **absent** :
1. Basculer automatiquement sur **l'avant-dernier point valide** (`BackupService.restoreLatest` le fait et signale `degraded=true` + alerte).
2. **Documenter la perte de données résultante** : RPO dégradé = âge du point de repli (peut dépasser 60 min).
3. Consigner l'incident (quel point, quel écart, cause de corruption) et escalader (§8).

---

## 5. Rétention & rotation

Politique paramétrable (`ops/pra/retention.json`, surchargeable par variables d'environnement) :
- Backups **horaires** conservés **≥ 48 h** glissantes (`BACKUP_HOURLY_RETENTION_HOURS`, défaut 48).
- Points **quotidiens** conservés **≥ 30 j** (`BACKUP_DAILY_RETENTION_DAYS`, défaut 30).
- La rotation (`BackupService.pruneExpired`) supprime les objets antérieurs au seuil de chaque cadence.

---

## 6. Custody des clés — **RISQUE DOCUMENTÉ**

> ⚠️ Un backup chiffré **dont la clé est perdue est irrécupérable** (perte totale).
> ⚠️ Une clé qui fuite rend **tous les backups** déchiffrables par l'attaquant.

Règles :
- `BACKUP_ENCRYPTION_KEY` stockée **hors du bucket de backup** (jamais au même endroit que les données qu'elle protège), idéalement dans un **KMS/coffre** (Vault/gestionnaire de secrets).
- **Rotation de clé** : le format d'enveloppe est versionné (octet de version) → une future clé `v2` cohabite avec les backups `v1` le temps de la rétention.
- **Double custody** recommandée (au moins deux détenteurs) pour éviter le point de défaillance humain unique.
- Ne JAMAIS logguer la clé ni la committer.

---

## 7. RPO/RTO à taille réelle — **GATED infra** (arbitrage D11)

La **mécanique** est livrée et testée **maintenant** en CI sur stockage mock + PostgreSQL Testcontainers (game day). En revanche :
- La **mesure RTO à taille de base réelle** (download depuis R2 distant + `pg_restore` sur volume réel + bande passante) est **gated infra** : elle exige un environnement de restauration représentatif. À exécuter et chronométrer sur cet environnement avant de déclarer la cible 15 min tenue en prod.
- La **cadence horaire réelle** (planificateur cron/BullMQ repeatable en prod) prouve le RPO ≤ 60 min opérationnel : à valider sur l'infra de déploiement.
- Le game day CI **asserte les cibles** (RTO ≤ 15 min, RPO ≤ 60 min) pour prouver la mécanique de chronométrage ; les chiffres CI sont de l'ordre de la seconde (seed réduit) et ne remplacent pas la mesure à taille réelle.

---

## 8. Escalade

| Situation | Action |
|---|---|
| Poussée de backup non confirmée (alerte ops) | Vérifier accès R2 + espace ; rejouer le backup ; si récurrent → escalader ops. |
| Dernier backup corrompu | Bascule point précédent (§4) + incident. |
| Déchiffrement impossible | Vérifier `BACKUP_ENCRYPTION_KEY` (custody §6) ; ne pas restaurer un dump douteux ; escalader sécurité. |
| RTO > 15 min | Incident RTO : consigner la durée, analyser le goulot (download / restore / health), réviser le dimensionnement infra. |
| Aucun backup valide | Incident **majeur** perte de données : escalade immédiate PO/ops + communication. |

---

## 9. Dry-run tracé (validation du runbook)

Un runbook non testé n'est pas un runbook. Le **dry-run** de cette procédure est **automatisé et tracé** par le game day CI :
`apps/api/src/pra/gameday-restore.integration.test.ts` — il exécute seed → backup chiffré → push mock → restore base neuve → vérification d'intégrité (comptes + contraintes + téléphone resté chiffré) → chronométrage RTO, à chaque run de la suite. Toute régression (intégrité divergente ou RTO dépassé) **fait échouer la CI**.
