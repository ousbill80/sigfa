# offline-resilience — Harness

## Ce que cette suite garantit (règles T4–T7)

Cette suite valide la **résilience en mode hors ligne** du kiosque et du mobile SIGFA.
Elle simule des coupures réseau et vérifie le rejeu idempotent des opérations.

### Règles couvertes

- **T4** — Les opérations en mode offline sont enregistrées et rejouées sans perte.
- **T5** — Le simulateur réseau est injectable — pas de vrai appel réseau dans ces tests.
- **T6** — Le journal d'appels enregistre type + payload + timestamp pour chaque opération.
- **T7** — Le rejeu est idempotent : rejouer N fois ne duplique pas les entrées.

### Harness disponible

- `createNetworkSimulator()` — Simulateur réseau on/off injectable.
  - `isOnline()` — true si le réseau est disponible.
  - `goOffline()` / `goOnline()` — Commute l'état réseau.

- `createSyncReplayJournal()` — Journal de rejeu pour vérifier l'idempotence.
  - `record({ type, payload })` — Enregistre une opération.
  - `replay()` — Retourne toutes les entrées (structure pour assertion).
  - `getEntries()` — Accès direct aux entrées.

### Hors scope ici

Les cas réels kiosk/mobile offline (sync BullMQ, retry politique) sont couverts en F5.
