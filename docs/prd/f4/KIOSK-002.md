## KIOSK-002 : Écran Accueil/Langue — 4 cartes, état de file visible, timeout 30 s

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-001 · **Statut** : TODO

**Révision** : v2 — arbitrage 19

> **DESIGN-gate** : wireframe + 5 états + copie validés par revue humaine avant implémentation.

### Exigences (EARS)

- UBIQUITAIRE : l'écran affiche 4 cartes de langue égales (Français / Dioula / Baoulé / English), hauteur minimale 120 px, label 28 px (`--action-label`), icône drapeau/motif + texte toujours appariés — jamais l'un sans l'autre.
- UBIQUITAIRE : chaque carte est une cible tactile ≥ 72×72 px avec espacement ≥ 16 px entre cibles ; contraste ≥ 7:1 sur fond `--surface-kiosk: #0E1420`.
- QUAND l'écran s'affiche, le système doit présenter l'état de la file (`queue:updated` → `length` + `estimate`) en bas de l'écran avant toute interaction — honnêteté immédiate.
- QUAND l'utilisateur touche une carte de langue, le système doit confirmer la sélection vocalement dans la langue choisie (Web Speech API) et naviguer vers KIOSK-003 en ≤ 250 ms (transition `cubic-bezier(0.2, 0.8, 0.2, 1)`).
- QUAND 30 secondes d'inactivité s'écoulent sur n'importe quel écran, le système doit revenir à cet écran avec un fondu (250 ms) — sauf en mode accessibilité où le délai est 60 s.
- SI l'état de la file est indisponible (réseau coupé), ALORS le système doit afficher le bandeau offline discret (`--info: #2E90FA`) : « Mode hors connexion — vos tickets restent valables », sans bloquer la sélection de langue.
- LÀ OÙ le titre de l'écran contient « Akwaba », ce mot doit être présent dans la locale FR et la locale EN uniquement (décision copie à valider au DESIGN-gate).

### Critères d'acceptation

- [ ] `KIOSK-002: 4 cartes rendues à hauteur ≥ 120 px, label 28 px, icône + texte (Testing Library snapshot ×4 langues)`
- [ ] `KIOSK-002: contraste cartes sur --surface-kiosk ≥ 7:1 (axe-core audit)`
- [ ] `KIOSK-002: queue:updated reçu → longueur de file affichée sans recharge`
- [ ] `KIOSK-002: timeout 30 s → retour accueil (Vitest fake-timer)`
- [ ] `KIOSK-002: timeout accessibilité 60 s → retour accueil (Vitest fake-timer)`
- [ ] `KIOSK-002: offline → bandeau --info visible, navigation langue non bloquée`
- [ ] `KIOSK-002: screenshot de référence commité dans les 4 langues (régression visuelle)`
- [ ] `KIOSK-002: DESIGN-gate validé (label PR 'design-approved') avant merge`

### Hors scope de cette story

Choix du service (KIOSK-003), accessibilité vocale complète (KIOSK-008), mode accessibilité ♿ (KIOSK-008).
