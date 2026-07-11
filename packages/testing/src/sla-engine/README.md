# sla-engine — Harness

## Ce que cette suite garantit (règles T4–T7)

Cette suite valide les **calculs de SLA (TMA/TMT)** dans SIGFA via une horloge contrôlable.
Elle utilise les fake timers Vitest pour un contrôle précis au milliseconde.

### Règles couvertes

- **T4** — Les calculs SLA sont exacts au ms (pas d'approximation horloge murale).
- **T5** — L'horloge est contrôlée par fake timers — aucune dépendance au temps réel.
- **T6** — La timeline (issuedAt, calledAt, servedAt, closedAt) permet le calcul TMA/TMT.
- **T7** — Les fake timers sont restaurés proprement après chaque test.

### Harness disponible

- `buildTicketTimeline({ issuedAt })` — Construit une timeline mutable pour un ticket.
  - `setCalledAt(date)` — Définit l'heure d'appel.
  - `setServedAt(date)` — Définit l'heure de début de service.
  - `setClosedAt(date)` — Définit l'heure de clôture.
  - `getDurations()` — Retourne { waitingMs, serviceMs, totalMs }.

### Usage avec fake timers

```typescript
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));
const timeline = buildTicketTimeline({ issuedAt: new Date() });
vi.advanceTimersByTime(5 * 60 * 1000);
timeline.setCalledAt(new Date());
```

### Hors scope ici

La logique métier (priorités, calculs TMA/TMT réels) est couverte en F3/SLA-xxx.
