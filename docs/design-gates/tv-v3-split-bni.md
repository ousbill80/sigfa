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
3. **Colonne droite ~25 %** (fond `--night-2`, séparateur), de haut en bas :
   - **Carte appel courant** : libellé guichet + numéro ticket en très grand
     (`--display-tv-counter`, `--font-display`, `tabular-nums`). Au nouvel
     appel, la carte passe en fond `--brand` avec halo (mécanique
     celebration/reducedMotion TV-002 conservée) pendant la fenêtre de
     célébration, puis revient au repos. **La pub n'est jamais interrompue.**
   - **Derniers appelés** (`TV_PREVIOUS_COUNT`) : numéro + guichet, en retrait
     (`--ink-inverse-soft`), style PreviousCard.
   - En bas : **« En attente : N »** (longueur de file, style conservé).
4. **5 états conservés** : nominal · loading (skeleton adapté au split) ·
   empty (carte affiche l'état vide traduit, la pub continue) · error ·
   offline (bandeau bas existant inchangé).
5. Contraintes : tokens uniquement, i18n `t()` FR/EN, lisibilité salle
   d'attente (6-8 m), `data-testid` conservés/étendus, logique temps réel
   inchangée (`use-tv-mode` devenu obsolète → supprimé).
