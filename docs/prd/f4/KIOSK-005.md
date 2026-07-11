## KIOSK-005 : Le Moment Ticket — 128 px, pulse brand 400 ms, voix, impression, retour auto 4 s

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-004 · **Statut** : TODO

**Révision** : v2 — arbitrage 19

> **DESIGN-gate** : wireframe + 5 états + copie validés par revue humaine avant implémentation.

### Exigences (EARS)

- QUAND le ticket est émis, l'écran entier doit devenir le ticket : `displayNumber` en 128 px police Display couleur `--brand`, position et attente estimée en hiérarchie claire (position 40 px, attente 40 px), centré verticalement.
- QUAND le Moment Ticket s'affiche, le numéro doit pulser une unique fois (400 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`) — c'est le seul moment théâtral de l'interface.
- QUAND le Moment Ticket s'affiche, la synthèse vocale (Web Speech API) doit annoncer numéro + position + attente dans la langue de session ; l'annonce est déclenchée automatiquement, sans interaction.
- SI l'impression réussit (`printerStatus: OK` au dernier heartbeat), le système doit afficher « Votre ticket s'imprime… » (token `--success: #12B76A`, icône imprimante).
- SI un numéro de téléphone a été saisi, le système doit afficher « SMS envoyé au 07 •• •• •• 47 » (masqué, 4 derniers chiffres visibles) — uniquement si `smsConsent: true`.
- Le système doit revenir à l'écran Accueil/Langue automatiquement après 4 secondes (8 secondes en mode accessibilité).
- LÀ OÙ `prefers-reduced-motion` est actif, le pulse doit être remplacé par une apparition statique — zéro animation, contenu identique.

### Critères d'acceptation

- [ ] `KIOSK-005: numéro rendu à 128 px, token --brand, dans les 4 langues sans débordement (Testing Library snapshot)`
- [ ] `KIOSK-005: pulse 400 ms déclenché une seule fois, absent en reduced-motion (mock animation API)`
- [ ] `KIOSK-005: annonce vocale déclenchée dans la langue de session (mock Web Speech API)`
- [ ] `KIOSK-005: printerStatus OK → message impression visible avec --success`
- [ ] `KIOSK-005: phoneNumber saisi + smsConsent → numéro masqué visible`
- [ ] `KIOSK-005: retour accueil à 4 s (Vitest fake-timer)`
- [ ] `KIOSK-005: retour accueil à 8 s en mode accessibilité (Vitest fake-timer)`
- [ ] `KIOSK-005: reduced-motion → zéro animation, contenu identique (snapshot diff)`
- [ ] `KIOSK-005: screenshot de référence commité ×4 langues (régression visuelle Playwright)`
- [ ] `KIOSK-005: DESIGN-gate validé avant merge`

### Hors scope de cette story

Logique offline Dexie (KIOSK-006), états dégradés imprimante HS (KIOSK-007), synthèse vocale mode accessibilité ralentie (KIOSK-008), driver imprimante matérielle (story dédiée).
