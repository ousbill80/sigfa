## KIOSK-009 : Feedback post-service sur borne — note 1-5, commentaire vocal optionnel

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-005 · **Statut** : DONE (2026-07-12)

**Révision** : v2 — arbitrage 19

### Exigences (EARS)

- QUAND un client a préalablement saisi un `trackingId` et que le ticket est en état `DONE` (vérifié via GET `/public/tickets/{trackingId}`), le système peut afficher l'écran feedback ; hors état DONE ou fenêtre > 24 h → l'écran n'est pas proposé.
- QUAND l'écran feedback s'affiche, le système doit présenter 5 étoiles tactiles (cibles ≥ 72×72 px, espacement ≥ 16 px, label 28 px) comme unique question principale — une décision par écran.
- QUAND l'utilisateur sélectionne une note et valide, le système doit appeler POST `/public/tickets/{trackingId}/feedback` via `@sigfa/contracts` avec `note: 1–5` et `comment` optionnel (≤ 500 caractères).
- QUAND POST `/public/tickets/{trackingId}/feedback` retourne 409 `FEEDBACK_ALREADY_SUBMITTED`, le système doit afficher un message de remerciement neutre sans erreur visible — l'opération est déjà faite.
- QUAND POST `/public/tickets/{trackingId}/feedback` retourne 422 `TICKET_NOT_CLOSED | FEEDBACK_WINDOW_EXPIRED`, le système doit ignorer silencieusement et naviguer vers l'accueil.
- SI le bouton 🎤 de commentaire vocal est activé (Web Speech API SpeechRecognition), ALORS la transcription est affichée dans un champ texte ≤ 500 caractères avant soumission — l'utilisateur peut la modifier ou l'effacer.
- Le système doit revenir automatiquement à l'écran Accueil/Langue après 30 secondes d'inactivité sur cet écran (60 s mode accessibilité).
- LÀ OÙ `SpeechRecognition` n'est pas disponible dans l'environnement Electron, le bouton 🎤 est masqué silencieusement ; le commentaire textuel reste disponible.

### Critères d'acceptation

- [ ] `KIOSK-009: écran feedback affiché uniquement si ticket DONE et < 24 h (mock GET /public/tickets)`
- [ ] `KIOSK-009: 5 étoiles tactiles ≥ 72 px, label 28 px (snapshot Testing Library ×4 langues)`
- [ ] `KIOSK-009: POST /public/tickets/{trackingId}/feedback appelé avec note 1-5 et X-Idempotency-Key`
- [ ] `KIOSK-009: 409 FEEDBACK_ALREADY_SUBMITTED → message remerciement, zéro erreur visible`
- [ ] `KIOSK-009: 422 TICKET_NOT_CLOSED → navigation accueil silencieuse`
- [ ] `KIOSK-009: commentaire vocal → transcription ≤ 500 caractères dans champ éditable`
- [ ] `KIOSK-009: SpeechRecognition absent → bouton 🎤 masqué, commentaire textuel disponible`
- [ ] `KIOSK-009: timeout 30 s → retour accueil (Vitest fake-timer)`
- [ ] `KIOSK-009: contraste ≥ 7:1 sur --surface-kiosk (axe-core)`

### Hors scope de cette story

Agrégation NPS côté serveur (API-010), NLP feedbacks (IA-004), feedback post-service mobile (MOB-005).
