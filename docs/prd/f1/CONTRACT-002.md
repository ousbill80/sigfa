# CONTRACT-002 : Contrat des événements Socket.io temps réel

**Module** : F1 — Contrats · **Agent** : agent-contract · **Dépend de** : CONTRACT-001 · **Statut** : TODO
**Fichier possédé** : `packages/contracts/events/realtime.ts`

## Exigences (EARS)

- Le contrat doit définir chaque événement comme objet TypeScript exporté : `{ name, payloadSchema (Zod), emitter, consumers, room }` — types inférés via `z.infer`, réutilisant les schémas de `@sigfa/schemas` et les shapes du core (jamais de duplication).
- Événements obligatoires (source CONTRACT-SPEC §10) :
  - `ticket:created` `{ ticket, position, estimate }` → borne, dashboard
  - `ticket:called` `{ ticket, counter }` → écran TV, dashboard, mobile — **contrainte documentée : réception <500 ms**, exportée en constante `TICKET_CALLED_SLA_MS = 500` ; description : contexte de charge contractualisé 50 agences × 100 tickets/min via Redis pub/sub (mesure réelle : RT-002)
  - `ticket:closed` `{ ticketId, waitTime, serviceTime }` → dashboard
  - `counter:status` `{ counterId, status, agentId }` → dashboard
  - `queue:updated` `{ queueId, length, estimate }` → borne, dashboard, mobile
  - `agency:offline` `{ agencyId, since }` → dashboard réseau
  - `alert:manager` `{ type, payload }` (types énumérés : AGENT_INACTIVE, SLA_BREACH, AGENT_DISCONNECTED_WITH_TICKET, QUEUE_CRITICAL) → dashboard manager — frontière avec les anomalies IA (CONTRACT-008) : l'alerte est INSTANTANÉE (1 occurrence), l'anomalie est un motif agrégé
  - `kiosk:printer-error` `{ kioskId, agencyId, since }` → dashboard manager (alimenté par le heartbeat borne, CONTRACT-003)
- Le contrat doit définir le modèle de **rooms** : `agency:{agencyId}` ; l'authentification socket (JWT) et le scope tenant du join doivent être documentés (un socket ne peut joindre que les rooms de sa banque).
- Le contrat doit définir la sémantique de **reconnexion** : QUAND un client se reconnecte, il doit pouvoir demander un resync (`sync:request` → `sync:state` avec l'état courant de la file) — payloads contractualisés.
- SI un payload ne valide pas son schéma Zod à l'émission, ALORS l'événement ne doit pas partir (contrat consommé par l'implémentation F3 — documenté ici).

## Critères d'acceptation

- [ ] `CONTRACT-002: chaque événement exporte name + payloadSchema Zod + emitter + consumers + room (test parcourant les exports)`
- [ ] `CONTRACT-002: les 8 événements + sync:request/sync:state sont définis (test d'inventaire)`
- [ ] `CONTRACT-002: la constante TICKET_CALLED_SLA_MS = 500 est exportée (test d'inventaire)`
- [ ] `CONTRACT-002: tout payload d'exemple valide son schéma (test par événement)`
- [ ] `CONTRACT-002: zéro type manuel — tous z.infer (revue + grep)`
- [ ] `CONTRACT-002: typecheck strict vert, types consommables depuis @sigfa/contracts`

## Hors scope
Implémentation serveur Socket.io (API-006) · client temps réel (F4) · garanties de latence mesurées (RT-002 — ici seulement contractualisées).
