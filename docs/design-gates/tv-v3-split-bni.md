# SIGFA — Design-gate TV v3 « split permanent »

> Statut : **VALIDÉ PO le 2026-07-13** sur photo de référence (écran BNI en
> agence réelle), option retenue : **« flash dans la colonne »**.
> Remplace les deux modes exclusifs de l'écran `/tv` (appel plein écran vs pub
> plein écran) par un split permanent pub + colonne d'appels.

---

## Wireframe validé

```
┌─────────────────────────┬─────────┐
│ ● Banque · Agence  14:10│ GUICHET2│
├─────────────────────────│ ▓▓▓▓▓▓▓ │
│                         │ ▓ P008▓ │ ← flash --brand à l'appel
│    PUB / CAMPAGNE       │ ▓▓▓▓▓▓▓ │
│    (carrousel continu)  ├─────────┤
│                         │P007 · G1│
│                         │P006 · G3│
│                         ├─────────┤
│                         │Attente12│
└─────────────────────────┴─────────┘
```

## Spécification appliquée

1. **Bandeau haut** (`--tv-header-height`, fond `--brand`, texte inverse) :
   pastille logo + nom banque/agence à gauche · date complète FR/EN au centre ·
   horloge en bloc contrasté à droite (grande, `tabular-nums`).
2. **Zone gauche ~75 %** : carrousel `AdZone` existant, actif **en permanence**
   (plus seulement au repos). Adapté au conteneur : ne rend plus son propre
   header.
3. **Colonne droite ~25 %** (fond `--night-2`, séparateur, `container-type:
   inline-size`, `overflow: hidden` — la colonne ne scrolle JAMAIS), de haut
   en bas :
   - **Carte appel courant** : libellé guichet + numéro ticket en très grand.
     Le numéro tient sur **UNE ligne** quelle que soit sa longueur raisonnable
     (format XX-999) : `white-space: nowrap` + taille fluide
     `clamp(--text-4xl, 22cqw, --display-tv-counter)` adaptée à la largeur
     réelle de la colonne (~60px à 720p, ~95px à 1080p, plafond token 120px
     en 4K — reste l'info n°1, lisible à 6-8 m). Au nouvel appel, la carte
     passe en fond `--brand` avec halo (mécanique celebration/reducedMotion
     TV-002 conservée) pendant la fenêtre de célébration, puis revient au
     repos. **La pub n'est jamais interrompue.**
   - **Derniers appelés** (≤ `TV_PREVIOUS_COUNT`) : DISCRETS — hiérarchie
     forte face à l'appel courant. Chaque entrée sur UNE ligne
     « OC-046 · Guichet 1 » : numéro `--text-2xl` max, guichet `--text-md`,
     en retrait (`--ink-inverse-soft`). La liste vit dans un espace flexible
     BORNÉ (`flex: 1 1 0%` + `min-height: 0` + `overflow: hidden`) : seul ce
     qui tient est affiché, aucun débordement possible.
   - En bas : **« En attente : N »** — ancré dans son PROPRE espace réservé
     (`flex-shrink: 0`, plus de marge auto), compteur en `--display-tv`
     (nettement sous le numéro courant). Jamais chevauché par la liste,
     toujours dans le viewport (720p / 1080p / 4K).
4. **5 états conservés** : nominal · loading (skeleton adapté au split) ·
   empty (carte affiche l'état vide traduit, la pub continue) · error ·
   offline (bandeau bas existant inchangé).
5. Contraintes : tokens uniquement, i18n `t()` FR/EN, lisibilité salle
   d'attente (6-8 m), `data-testid` conservés/étendus, logique temps réel
   inchangée (`use-tv-mode` devenu obsolète → supprimé).

## Correctif visuel du 2026-07-13 (retour PO sur capture réelle 16:9)

La v1 de cette story, validée aux tests unitaires seuls, était visuellement
cassée sur écran réel (~2000px). Défauts corrigés (`TV-V3-FIX`) :

1. **« OC-047 » cassait sur 2 lignes** : `--display-tv-counter` (120px) fixe
   était trop grand pour la colonne ~25 % → taille clampée sur la largeur de
   colonne (cf. §3), `nowrap`.
2. **Historique démesuré** (quasi aussi gros que l'appel courant) → entrées
   discrètes sur une ligne, `--text-2xl` / `--text-md`.
3. **Chevauchement liste / « En attente »** (textes superposés, item coupé
   par le bas de l'écran) → liste bornée en flex, « En attente » ancré,
   colonne `overflow: hidden`, compteur file `--display-tv` (au lieu de
   `--display-tv-counter`, qui aurait dominé le numéro courant clampé).

Vérifié visuellement (screenshots Playwright `/tv` nominal simulé) à
1280×720, 1920×1080 et 3840×2160 : numéro sur une ligne, hiérarchie forte,
aucun chevauchement, aucun scroll.
