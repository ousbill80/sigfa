# Rétention `audit_log` — job d'exploitation (DB-004)

## Décision consignée : immuabilité ≠ rétention

La table `audit_log` est **immuable** (append-only) : aucun `UPDATE`/`DELETE` n'est possible,
ni pour le rôle applicatif `sigfa_app` (privilèges `REVOKE`d), ni pour le propriétaire
(triggers `BEFORE UPDATE/DELETE ... RAISE EXCEPTION`).

La **purge à 24 mois** est une préoccupation distincte, **volontairement NON implémentée
en trigger** : un trigger de purge serait une forme de mutation cachée qui contredirait
l'invariant d'immuabilité et rendrait le comportement non déterministe. La purge est donc
un **job d'exploitation** documenté ici, exécuté hors ligne de requête applicative.

## Procédure de purge (exploitation)

La purge est exécutée par le **rôle propriétaire/migrateur** (BYPASSRLS), jamais par
`sigfa_app`. Comme `DELETE` est bloqué par le trigger d'immuabilité, la purge doit :

1. Détacher temporairement le trigger d'immuabilité DELETE, OU utiliser un partitionnement
   par période avec `DROP`/`DETACH PARTITION` (approche recommandée à l'échelle).

### Option A — partitionnement mensuel (recommandé à terme)

`audit_log` peut être migrée vers une table partitionnée par `occurred_at` (RANGE mensuel).
La purge devient un `DROP TABLE audit_log_YYYY_MM` de la partition la plus ancienne
(> 24 mois), opération instantanée qui ne viole pas l'immuabilité ligne à ligne.

### Option B — fenêtre de maintenance (petit volume)

En session de maintenance dédiée, sous le rôle migrateur :

```sql
BEGIN;
ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete;
DELETE FROM audit_log WHERE occurred_at < now() - interval '24 months';
ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete;
COMMIT;
```

Cette opération est **journalisée** dans le registre d'exploitation (qui, quand, combien de
lignes) et n'est **jamais** accessible depuis le chemin applicatif.

## Fréquence

Mensuelle. Story d'exploitation : créer une tâche planifiée « Purge audit_log > 24 mois ».

## Hors périmètre DB-004

L'implémentation du job de purge lui-même (planification, partitionnement effectif) est
**hors scope** de cette story — voir backlog exploitation.
