## KIOSK-003 : Écran Services — cartes icône+texte+attente temps réel, max 4 visibles, accès prioritaire ♿

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-002 · **Statut** : TODO

**Révision** : v2 — arbitrage 19

> **DESIGN-gate** : wireframe + 5 états + copie validés par revue humaine avant implémentation.

### Exigences (EARS)

- UBIQUITAIRE : chaque carte de service affiche : icône 40 px + label 28 px (`--action-label`) + attente estimée en temps réel (source : `queue:updated` → `estimate` converti en minutes) — jamais l'icône sans texte ni le texte sans icône.
- UBIQUITAIRE : les cartes sont pleine largeur, hauteur minimale 96 px, cibles ≥ 72 px, contraste ≥ 7:1 sur `--surface-kiosk: #0E1420`.
- UBIQUITAIRE : maximum 4 services visibles sans scroll ; les services supplémentaires sont accessibles via un bouton « voir plus de services » (label 28 px) avec défilement doux — jamais un carrousel.
- QUAND `queue:updated` est émis par le serveur (room `agency:{agencyId}`), le système doit mettre à jour l'attente estimée sur la carte concernée en temps réel sans recharge d'écran.
- QUAND un service a le statut `CLOSED` (file `CLOSED` ou `PAUSED`), la carte doit rester visible mais grisée avec le texte de l'horaire (ex. « Ouvre demain à 8h00 ») — jamais de disparition silencieuse.
- QUAND l'utilisateur touche le bouton « ♿ Accès prioritaire » (discret, bas de l'écran, toujours visible), le système doit déclencher le parcours PMR/Senior : contraste renforcé, voix ralentie, textes +20 %, délai inactivité doublé.
- SI aucun service actif n'est disponible, ALORS le système doit afficher l'état `empty` : message humain + suggestion d'adresser à l'accueil.
- LÀ OÙ `prefers-reduced-motion` est actif, le scroll « voir plus » est instantané sans animation.

### Critères d'acceptation

- [ ] `KIOSK-003: cartes rendues hauteur ≥ 96 px, icône 40 px + label 28 px (snapshot Testing Library ×4 langues)`
- [ ] `KIOSK-003: max 4 cartes visibles, bouton 'voir plus' présent si > 4 services`
- [ ] `KIOSK-003: queue:updated → estimation mise à jour sur la carte sans recharge (test Socket mock)`
- [ ] `KIOSK-003: service CLOSED → carte grisée avec horaire, non cliquable`
- [ ] `KIOSK-003: bouton ♿ → textes +20%, délai inactivité doublé (Vitest)`
- [ ] `KIOSK-003: état empty → message humain visible (Testing Library)`
- [ ] `KIOSK-003: contraste cartes ≥ 7:1 sur --surface-kiosk (axe-core)`
- [ ] `KIOSK-003: screenshot de référence commité dans les 4 langues`
- [ ] `KIOSK-003: DESIGN-gate validé avant merge`

### Hors scope de cette story

Confirmation + pavé numérique (KIOSK-004), routage VIP/PMR côté API (API-004), gestion offline (KIOSK-006).
