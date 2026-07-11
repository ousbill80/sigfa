# CONTRACT-012 : Amendement LA LOI — sync:state.recentCalls + KIOSK_SYSTEM_ERROR

**Module** : F1 — Contrats (amendement) · **Agent** : agent-contract · **Dépend de** : CONTRACT-011 (DONE) · **Statut** : DONE (2026-07-11)
**Origine** : Boucle 1 F3+F4 (arbitrage `19-critique-arbitrage-f3-f4.md`). Fenêtre pré-implémentation clients — non-breaking (ajouts).

## Exigences (EARS)
- `events/realtime.ts` : `syncStateEvent.payloadSchema` gagne `recentCalls: [{ ticketNumber, displayNumber, counterLabel, calledAt }]` (les 4 derniers CALLED de l'agence, constante `SYNC_RECENT_CALLS = 4` exportée) — reconstruction complète de l'écran TV après reconnexion.
- `alertManagerTypeSchema` gagne `KIOSK_SYSTEM_ERROR` (émetteur : api-server — sur échecs système borne remontés par sync/heartbeat).
- Tests structurels ajustés (TDD) ; typecheck strict ; aucun YAML modifié (contrat événements uniquement).

## Critères d'acceptation
- [ ] `CONTRACT-012: recentCalls typé + SYNC_RECENT_CALLS=4 exporté + exemple valide son schéma (tests)`
- [ ] `CONTRACT-012: KIOSK_SYSTEM_ERROR dans l'enum + payload d'exemple valide (test)`
- [ ] `CONTRACT-012: 219+ tests contracts verts, zéro régression`

## Hors scope
Toute autre évolution · émission réelle (API-005/006/011) · consommation TV (TV-002).
