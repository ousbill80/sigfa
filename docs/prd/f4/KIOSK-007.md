## KIOSK-007 : États dégradés — imprimante HS, file longue (SMS), service fermé, erreur système

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : KIOSK-005, CONTRACT-012 · **Statut** : TODO

**Révision** : v2 — arbitrage 19

### Exigences (EARS)

- QUAND le heartbeat retourne `printerStatus: PAPER_LOW | ERROR | OFFLINE`, le système doit basculer transparentement : affichage du numéro prolongé à 8 s, SMS fortement suggéré, message « Photographiez votre numéro ou recevez-le par SMS » — aucune mention de panne à l'écran client.
- QUAND `printerStatus != OK` est détecté via `/kiosks/{kioskId}/heartbeat`, le système doit déclencher l'événement `kiosk:printer-error` (consommé par le dashboard manager) sans délai.
- QUAND l'attente estimée d'une file dépasse le seuil de « file longue » (configurable, défaut : 30 min), le système doit afficher proactivement : « Forte affluence — environ {estimate} min. Recevez un SMS et revenez à l'heure de votre passage. » avec le champ téléphone mis en avant (not optionnel visuellement dans ce contexte).
- QUAND un service a le statut `CLOSED`, la carte reste visible mais grisée avec le texte « Ouvre demain à 8h00 » (ou horaire réel depuis `closeAt` de la file) — jamais de disparition silencieuse.
- QUAND une erreur système se produit (POST `/public/tickets` retourne 500 après 2 tentatives), le système doit afficher : « Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous. » (token `--danger: #F04438` pour le pictogramme uniquement, jamais le fond d'écran) + alerte silencieuse `alert:manager` de type **`KIOSK_SYSTEM_ERROR`** (CONTRACT-012 — type `SLA_BREACH` incorrect pour ce cas, corrigé).
- **Extension réseau** : QUAND le réseau est coupé APRÈS réception du 201 (ticket créé) mais AVANT confirmation de l'imprimante, le système doit afficher le numéro pendant **8 secondes** + message « Photographiez votre numéro » ; à la reconnexion, si le statut imprimante est ERROR, émettre `kiosk:printer-error`.
- SI le toucher est répété en rafale pendant un chargement, ALORS le système doit retourner un retour visuel immédiat (< 100 ms) à chaque toucher sans déclencher une action supplémentaire — l'écran ne « meurt » jamais.

### Critères d'acceptation

- [ ] `KIOSK-007: printerStatus PAPER_LOW → affichage prolongé 8 s, message 'Photographiez' visible`
- [ ] `KIOSK-007: printerStatus ERROR → kiosk:printer-error émis (mock Socket, Vitest)`
- [ ] `KIOSK-007: printerStatus OK → affichage normal 4 s, aucun message dégradé`
- [ ] `KIOSK-007: estimatedWaitMinutes ≥ seuil → message affluence + champ tel mis en avant (Testing Library)`
- [ ] `KIOSK-007: service CLOSED → carte grisée avec horaire, non cliquable (snapshot ×4 langues)`
- [ ] `KIOSK-007: POST 500 ×2 → message humain registre SIGFA, aucun code d'erreur visible`
- [ ] `KIOSK-007: touchers rapides → retour visuel < 100 ms, zéro doublon de soumission`
- [ ] `KIOSK-007: --danger uniquement sur pictogramme (grep token-usage, pas de fond #F04438)`
- [ ] `KIOSK-007: alert:manager KIOSK_SYSTEM_ERROR émis sur erreur système (type CONTRACT-012 — jamais SLA_BREACH, mock Socket)`
- [ ] `KIOSK-007: réseau coupé après 201 avant confirmation imprimante → numéro affiché 8 s + "Photographiez votre numéro" ; retour réseau avec printer ERROR → kiosk:printer-error émis`

### Hors scope de cette story

Logique offline Dexie (KIOSK-006), driver imprimante matérielle, supervision borne centralisée (ADM-003).
