## KIOSK-004 : Écran Confirmation — pavé numérique natif 72 px, téléphone facultatif, consentement UEMOA

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-003 · **Statut** : TODO

**Révision** : v2 — arbitrage 19

> **DESIGN-gate** : wireframe + 5 états + copie validés par revue humaine avant implémentation.

### Exigences (EARS)

- UBIQUITAIRE : le pavé numérique est natif au kiosque (jamais le clavier système OS) ; touches ≥ 72×72 px, espacement ≥ 16 px, retour sonore immédiat (< 100 ms) si le matériel ne supporte pas le haptique.
- UBIQUITAIRE : le numéro de téléphone est **explicitement facultatif** ; le bouton « Passer » (label 28 px, couleur neutre grisé) est visible et prominent — jamais culpabilisant.
- UBIQUITAIRE : le CTA principal « Prendre mon ticket » (fond `--brand`, label 28 px, hauteur 88 px) est présent en permanence quelle que soit la saisie.
- QUAND l'utilisateur saisit un numéro de téléphone, le système doit afficher une ligne de consentement SMS claire (conforme UEMOA) : l'opt-in `smsConsent: true` n'est transmis que si le numéro est saisi et la case validée.
- QUAND l'utilisateur touche « Prendre mon ticket », le système doit appeler POST `/public/tickets` via `@sigfa/contracts` avec `channel: "KIOSK"`, `X-Idempotency-Key` généré côté client (UUID v4), `priority` issu du parcours PMR si activé.
- QUAND POST `/public/tickets` retourne 201, le système doit naviguer vers KIOSK-005 avec `trackingId`, `number`/`displayNumber`, `position`, `estimatedWaitMinutes`.
- QUAND POST `/public/tickets` retourne 409 `IDEMPOTENCY_CONFLICT`, le système doit considérer le ticket comme déjà émis et naviguer vers KIOSK-005 avec la réponse originale.
- SI POST `/public/tickets` échoue (réseau coupé), ALORS le système doit basculer vers la logique offline via le hook **`useOfflineTicket()`** (déclaré en STUB dans KIOSK-004, implémenté dans KIOSK-006 — Dexie.js numérotation locale) sans message d'erreur visible pour le client.
- LÀ OÙ le numéro saisi est invalide (format non E.164 après préfixe CI `+225`), le bouton « Prendre mon ticket » doit afficher l'état `error` inline : « Il manque votre numéro — ou touchez Passer ».

### Critères d'acceptation

- [ ] `KIOSK-004: pavé numérique rendu avec touches ≥ 72 px, jamais de clavier OS (snapshot)`
- [ ] `KIOSK-004: bouton Passer visible et cliquable sans saisie de téléphone`
- [ ] `KIOSK-004: smsConsent absent si phoneNumber vide (vérification payload)`
- [ ] `KIOSK-004: X-Idempotency-Key UUID v4 généré et inclus dans chaque POST /public/tickets`
- [ ] `KIOSK-004: POST 201 → navigation KIOSK-005 avec trackingId, displayNumber, position, estimatedWaitMinutes`
- [ ] `KIOSK-004: POST 409 IDEMPOTENCY_CONFLICT → navigation KIOSK-005 sans doublon`
- [ ] `KIOSK-004: hook useOfflineTicket() déclaré stub (interface + retour mock) — importable par l'écran Confirmation`
- [ ] `KIOSK-004: réseau coupé → bascule offline via useOfflineTicket() stub sans écran d'erreur visible`
- [ ] `KIOSK-004: numéro invalide → message inline registre SIGFA (Testing Library ×4 langues)`
- [ ] `KIOSK-004: CTA hauteur 88 px, token --brand (snapshot)`
- [ ] `KIOSK-004: DESIGN-gate validé avant merge`

### Hors scope de cette story

Écran ticket (KIOSK-005), logique de numérotation offline (KIOSK-006), intégration driver imprimante (story matérielle dédiée).
