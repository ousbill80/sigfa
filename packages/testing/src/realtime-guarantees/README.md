# realtime-guarantees — Harness

## Ce que cette suite garantit (règles T4–T7)

Cette suite valide les **garanties de temps réel** dans SIGFA via Socket.io.
Elle mesure la latence événement->réception pour détecter toute régression de performance.

### Règles couvertes

- **T4** — Les événements temps réel sont reçus dans un délai acceptable (< seuil SLA).
- **T5** — Le serveur Socket.io est éphémère et réel, jamais mocké.
- **T6** — La latence est mesurée par le helper dédié (aller-simple local).
- **T7** — Le serveur et le client sont arrêtés proprement après chaque suite.

### Harness disponible

- `createRealtimeHarness()` — Crée un serveur Socket.io éphémère + client de test.
  - `measureEventLatency(emitEvent, ackEvent)` — Mesure la latence aller-simple en ms.
  - `teardown()` — Arrête le serveur et déconnecte le client.

### Hors scope ici

Les cas réels (notifications ticket, broadcast multi-tenant) sont couverts en F4.
