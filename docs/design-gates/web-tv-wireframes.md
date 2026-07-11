# SIGFA — Wireframes design-gate
# TV-001 · WEB-002 · WEB-003

> Statut : **EN ATTENTE GO HUMAIN** — aucune implémentation tant que ces wireframes n'ont pas reçu
> l'approbation explicite du product owner (règle DESIGN-gate § 4 CLAUDE.md).

---

## 1. TV-001 — Affichage TV file d'attente (16:9)

### Principe

Écran passif en salle d'attente. Ratio 16:9 (1920×1080 référence).
Ticket courant en héro 180 px. 3 tickets précédents en queue compacte.
File en attente sous forme de liste.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BANQUE DU COMMERCE         [logo tenant]           14:37:22  Ven 10 Jul   │
│  Agence Centre-Ville                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                                                                      │  │
│   │                  GUICHET 3  — MAINTENANT SERVI                       │  │ ← 180 px
│   │                                                                      │  │
│   │                        ╔═══════════╗                                 │  │
│   │                        ║   A-047   ║                                 │  │
│   │                        ╚═══════════╝                                 │  │
│   │                                                                      │  │
│   │          Veuillez vous présenter au guichet 3                        │  │
│   │                                                                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   DERNIERS APPELÉS                                                           │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                     │
│   │   A-046      │  │   B-012      │  │   A-045      │                     │
│   │  Guichet 1   │  │  Guichet 4   │  │  Guichet 2   │                     │
│   └──────────────┘  └──────────────┘  └──────────────┘                     │
│                                                                              │
│   EN ATTENTE (12 tickets)                                                    │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  A-048  A-049  A-050  B-013  B-014  A-051  B-015  A-052  …          │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  [■■■■■■■■■■■■■■■■■■■■■■] Message défilant agence        Powered by SIGFA  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Zones

| Zone | Hauteur | Contenu |
|---|---|---|
| Header | 60px | Logo tenant + nom agence + horloge temps réel |
| Héros | 180px | Ticket courant — numéro XXL, guichet, instruction |
| Précédents | 120px | 3 cartes horizontales — derniers tickets appelés |
| Queue | auto | Liste horizontale scrollante des tickets en attente |
| Ticker | 40px | Message agence défilant + branding |

### 5 états

| État | Comportement |
|---|---|
| **nominal** | Héros = ticket actif, précédents = 3 derniers, queue = liste live |
| **loading** | Squelette animé (shimmer) sur chaque zone, horloge active |
| **empty** | « Aucun ticket en cours » dans le héros, queue vide sans erreur |
| **error** | Texte « Connexion perdue » en héros, badge rouge en header, retry auto 30 s |
| **offline** | Fond légèrement grisé + bandeau discret bas « Mode hors ligne » |

### Interactions / auto-comportements

- Ticket héros : animation d'entrée scale 0.8→1.0 (0.3 s ease-out) à chaque nouvel appel
- Derniers appelés : défilé gauche ← droite, entrée par la gauche
- Queue : scroll horizontal auto, wrap si > écran
- Horloge : mise à jour chaque seconde (rendu client uniquement)
- Refresh auto : SocketIO RT-001 (INACTIVE jusqu'à RT-001) / polling 5 s fallback
- Responsive : calcul de font-size héros en `clamp(48px, 10vw, 140px)`
- Accessibilité : aria-live="polite" sur zone héros (annonce vocale optionnelle)

---

## 2. WEB-002 — Interface agent guichet

### Principe

Interface plein-écran pour l'agent au guichet. Action principale : appeler/terminer.
Ticket courant = 96 px. Chronomètre. Raccourci clavier Space.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [≡] SIGFA — Guichet 3        Agent: M. Koné                    [⏻ Quitter]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   TICKET EN COURS                              CHRONOMÈTRE                  │
│   ┌──────────────────────────────────┐   ┌──────────────────────────────┐   │
│   │                                  │   │                              │   │
│   │          ╔═══════════╗           │   │       00:03:47               │   │ ← 96px
│   │          ║   A-047   ║           │   │    ██████████░░░░░░          │   │
│   │          ╚═══════════╝           │   │    Moy. SLA: 05:00           │   │
│   │     Opération: Dépôt espèces     │   │                              │   │
│   │     En attente: 14 min           │   └──────────────────────────────┘   │
│   │                                  │                                      │
│   └──────────────────────────────────┘                                      │
│                                                                              │
│   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐   │
│   │                    │  │                    │  │                    │   │
│   │   ▶  APPELER       │  │   ✓  TERMINER      │  │   ⏸  SUSPENDRE     │   │
│   │   SUIVANT          │  │   SERVICE          │  │   (No show)        │   │
│   │                    │  │                    │  │                    │   │
│   │   [Space / →]      │  │   [Entrée / ✓]     │  │   [P / ⏸]          │   │
│   │                    │  │                    │  │                    │   │
│   └────────────────────┘  └────────────────────┘  └────────────────────┘   │
│                                                                              │
│   PROCHAINS TICKETS                                                          │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                            │
│   │A-048 │ │B-013 │ │A-049 │ │A-050 │ │B-014 │  …                         │
│   │14:22 │ │14:25 │ │14:28 │ │14:30 │ │14:31 │                            │
│   └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Zones

| Zone | Description |
|---|---|
| Header | Identité agent + numéro guichet + bouton quitter |
| Ticket courant | Numéro 96px, type d'opération, durée d'attente du client |
| Chronomètre | Temps écoulé depuis appel, barre de progression vs SLA, moyenne |
| 3 boutons d'action | APPELER SUIVANT (primaire), TERMINER (succès), SUSPENDRE (neutre) |
| File suivante | 5 tickets suivants avec heure d'arrivée |

### Raccourcis clavier

| Touche | Action |
|---|---|
| `Space` | Appeler le prochain ticket |
| `Entrée` | Terminer le service en cours |
| `P` | Suspendre / no-show |
| `Échap` | Annuler action en cours |
| `←` / `→` | Naviguer dans la file (lecture seule) |

### 5 états

| État | Comportement |
|---|---|
| **nominal** | Ticket actif, chrono qui tourne, 3 boutons actifs |
| **loading** | Boutons désactivés + spinner pendant appel API (max 2 s) |
| **empty** | « File vide — Aucun ticket en attente » ; bouton APPELER grisé |
| **error** | Toast rouge « Erreur réseau » ; dernière action rejouable |
| **offline** | Bandeau haut orange + boutons désactivés ; données locales affichées |

### Interactions

- `Space` → appelle API → met à jour ticket courant sans rechargement page
- Chrono reset à 00:00 à chaque appel d'un nouveau ticket
- Barre SLA vire au orange > 80%, rouge > 100%
- Suspendre → modal de confirmation (éviter no-show accidentel)
- Toast feedback toutes actions (succès vert, erreur rouge, 3 s)

---

## 3. WEB-003 — Dashboard Manager

### Principe

Tableau de bord superviseur. Hiérarchie en Z : KPIs globaux (haut) → grille agents (milieu)
→ graphiques historiques (bas). TMA coloré vs SLA. Actions OPEN/PAUSED sur chaque agent.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [≡] SIGFA — Gestion     Agence Centre-Ville    [🔔 3] [M.Traoré ▾] [⏻]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ── KPIs GLOBAUX ─────────────────────────────────────────────────────────  │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐  │
│  │ EN ATTENTE    │ │ TMA ACTUEL    │ │ SLA RESPECT.  │ │ AGENTS ACTIFS │  │
│  │     14        │ │   04:23       │ │    78 %       │ │    5 / 7      │  │
│  │ ▲ +2 vs J-7   │ │ ● > SLA 05:00 │ │ ▼ -3% vs J-7  │ │               │  │
│  └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘  │
│                                                                              │
│  ── GRILLE AGENTS ────────────────────────────────────────────────────────  │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ Agent         │ Guichet │ État   │ Ticket │ TMA    │ SLA   │ Actions  │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │ Koné A.       │   3     │ OPEN   │ A-047  │ 03:47  │  ✅   │ [⏸][→]  │ │
│  │ Diabaté F.    │   1     │ OPEN   │ A-046  │ 06:12  │  ⚠️   │ [⏸][→]  │ │ ← rouge TMA > SLA
│  │ Coulibaly M.  │   4     │ PAUSED │   —    │  —     │  —    │ [▶][→]  │ │ ← grisé
│  │ Ouédraogo S.  │   2     │ OPEN   │ B-012  │ 02:01  │  ✅   │ [⏸][→]  │ │
│  │ Traoré K.     │   5     │ OPEN   │ A-045  │ 08:33  │  🔴   │ [⏸][→]  │ │ ← alerte rouge
│  │ Bamba I.      │   6     │ PAUSED │   —    │  —     │  —    │ [▶][→]  │ │
│  │ Sanogo R.     │   7     │ CLOSED │   —    │  —     │  —    │ [▶]     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ── ANALYSE J-7 ──────────────────────────────────────────────────────────  │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  TMA par heure (aujourd'hui)  │  │ Tickets traités — aujourd'hui vs J-7 │ │
│  │                               │  │                                      │ │
│  │  06:00  ▁▁▂▃▄▅▆▇█▇▆▅▃▂▁▁    │  │  ████ auj.  ░░░░ J-7                │ │
│  │  SLA ─────────────── ─ ─ ─   │  │  Lun Mar Mer Jeu Ven Sam Dim        │ │
│  │                               │  │                                      │ │
│  └──────────────────────────────┘  └──────────────────────────────────────┘ │
│                                                                              │
│  ── ALERTES ───────────────────────────────────────────────────────────────  │
│  🔴 Traoré K. — TMA > SLA × 2 depuis 5 min — [Alerter] [Ignorer]          │
│  ⚠️  SLA global < 80% — File critique — [Voir détail]                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Zones (hiérarchie Z)

| Niveau Z | Zone | Contenu |
|---|---|---|
| Z1 (haut) | KPIs globaux | 4 métriques clés : file, TMA, SLA, agents actifs |
| Z1 | Comparaison J-7 | Delta colorimétriques (vert amélioration, rouge dégradation) |
| Z2 (milieu) | Grille agents | Tableau complet — état, ticket, TMA coloré, actions OPEN/PAUSED |
| Z2 | Actions rapides | Pause ⏸ / Reprendre ▶ / Détail → par ligne |
| Z3 (bas) | Sparklines TMA | Courbe TMA par heure vs ligne SLA |
| Z3 | Comparaison J-7 | Barres tickets traités jour courant vs semaine passée |
| Z3 | Alertes | Bandeau rouge — agents en dépassement critique |

### Codage couleur TMA vs SLA

| Ratio TMA/SLA | Couleur cellule | Icône |
|---|---|---|
| < 80% | Vert `--success` | ✅ |
| 80–100% | Orange `--warning` | ⚠️ |
| > 100% | Rouge `--danger` | 🔴 |

### 5 états

| État | Comportement |
|---|---|
| **nominal** | Données live, grille agents, sparklines, alertes si nécessaire |
| **loading** | Squelettes shimmer sur KPIs + grille ; spinner global discret en header |
| **empty** | KPIs à zéro, grille vide « Aucun agent connecté » ; sparklines flat |
| **error** | Banner rouge en haut « Données indisponibles » ; dernières valeurs connues ghostées |
| **offline** | Bandeau orange « Mode hors ligne — J-1 » ; sparklines depuis cache ; actions désactivées |

### Interactions

- Bouton ⏸ (pause agent) → modal confirmation + motif (pause déjeuner / incident)
- Bouton ▶ (reprendre) → reprend l'agent sans confirmation
- Bouton → (détail) → slide-over droit avec historique de l'agent + tickets du jour
- Clic KPI → filtre la grille agents (ex: clic « En attente » filtre par agents idle)
- Sparkline TMA → tooltip au hover avec valeur exacte + SLA
- Alertes → son discret si > SLA × 2 (configurable par manager)
- Auto-refresh via SocketIO RT-001 (INACTIVE) / polling 10 s fallback
- Export CSV : bouton discret en bas de grille (données du jour)
- Filtre période : sélecteur Aujourd'hui / J-7 / Mois dans l'entête analyse

### Comparaison J-7

- Delta affiché sous chaque KPI avec flèche ↑↓ et couleur directionnelle
- Sparklines : ligne pleine = aujourd'hui, ligne pointillée = même jour semaine passée
- Écart > 20% sur un KPI déclenche une alerte visuelle dans le header

---

## Règles communes (rappel design system)

- Tokens uniquement : `var(--brand)`, `var(--danger)`, `var(--surface-0)`, etc.
- Cibles touch ≥ 72px sur toutes les actions (pour tablettes managers)
- Texte ≥ 16px partout (≥ 24px sur TV-001)
- Contraste ≥ 4.5:1 WCAG AA (≥ 7:1 sur kiosques)
- 4 langues : FR (base), EN, AR (RTL), MG
- Icône + texte toujours appariés (jamais icône seule sans label ou aria-label)
