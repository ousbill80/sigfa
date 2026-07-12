## KIOSK-008 : Synthèse vocale 4 langues + mode accessibilité (+20 % textes, voix ralentie, timeout doublé)

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-005 · **Statut** : DONE (2026-07-12)

**Révision** : v2 — arbitrage 19

### Exigences (EARS)

- UBIQUITAIRE : un bouton 🔊 permanent (cible ≥ 72×72 px, visible sur tous les écrans) permet de déclencher manuellement la lecture vocale de l'écran courant dans la langue de session.
- UBIQUITAIRE : la synthèse vocale utilise Web Speech API `SpeechSynthesisUtterance` ; si aucune voix de la locale cible n'est disponible, le système doit utiliser la voix FR par défaut sans erreur visible.
- QUAND le parcours PMR/Senior est activé (bouton ♿ KIOSK-003 ou détection automatique), le système doit appliquer le mode accessibilité : textes de l'ensemble des écrans à base 28 px × 1.2 = 33.6 px, voix ralentie (`SpeechSynthesisUtterance.rate = 0.8`), délai d'inactivité × 2.
- QUAND le mode accessibilité est actif et que le Moment Ticket s'affiche, le retour accueil automatique doit se produire à 8 secondes (au lieu de 4 s en mode nominal).
- QUAND la synthèse vocale est déclenchée (auto au Moment Ticket, ou manuellement), le texte annoncé doit suivre le registre SIGFA : « Ticket {displayNumber}. Vous êtes {position}ᵉ dans la file. Environ {estimatedWaitMinutes} minutes. » dans la langue de session.
- SI la langue de session est Dioula ou Baoulé et qu'aucune voix native n'est disponible, ALORS le système doit utiliser la voix FR (fallback explicitement documenté) sans log d'erreur côté client.
- LÀ OÙ `prefers-reduced-motion` est actif, la transition d'activation du mode accessibilité est instantanée.

### Critères d'acceptation

- [ ] `KIOSK-008: bouton 🔊 ≥ 72 px présent sur tous les écrans (snapshot ×4 langues)`
- [ ] `KIOSK-008: SpeechSynthesisUtterance déclenché au Moment Ticket avec texte correct (mock Web Speech API)`
- [ ] `KIOSK-008: mode accessibilité → textes ≥ 34 px (snapshot CSS computed + Testing Library)`
- [ ] `KIOSK-008: mode accessibilité → SpeechSynthesisUtterance.rate = 0.8 (Vitest spy)`
- [ ] `KIOSK-008: mode accessibilité → timeout inactivité doublé (Vitest fake-timer)`
- [ ] `KIOSK-008: mode accessibilité → retour accueil à 8 s au Moment Ticket (Vitest fake-timer)`
- [ ] `KIOSK-008: locale Dioula/Baoulé sans voix native → fallback voix FR, zéro erreur visible`
- [ ] `KIOSK-008: contraste ≥ 7:1 maintenu en mode accessibilité (axe-core)`

### Hors scope de cette story

Reconnaissance vocale entrante (hors scope définitif SIGFA), NLP feedbacks (IA-004), driver audio matériel.
