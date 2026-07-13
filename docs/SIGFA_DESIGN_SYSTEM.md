> **⚠️ SUPPLANTÉ par [`SIGFA_DESIGN_SYSTEM_v2.md`](./SIGFA_DESIGN_SYSTEM_v2.md) depuis 2026-07-12 — conservé pour historique.**
> La v2 « Sérénité Premium » est la seule source de vérité design (tokens dans `packages/ui`).
> Ne rien implémenter depuis ce document. Index : [`docs/README.md`](./README.md).

---

# SIGFA — SYSTÈME DE DESIGN UX/UI
## Prompt Design · Kiosque Libre-Service · Dashboard · Mobile · Écran d'Appel

> **Version** : 1.0 · **Date** : Juillet 2026  
> **Statut** : ~~Document de référence design — source de vérité unique pour toute interface SIGFA~~ **SUPPLANTÉ (voir bandeau ci-dessus)**  
> **Complète** : SIGFA_PROMPT_v5.md (produit) · SIGFA_METHODE_CONCEPTION_AGENTIQUE.md (méthode)  
> **Consommateurs** : agent-kiosk · agent-web · agent-mobile · designers humains

---

# PARTIE I — RÔLE ET PHILOSOPHIE

## 1. Rôle du designer (humain ou agent)

Tu es le **directeur de design de SIGFA**. Tu conçois des interfaces pour un système de gestion de files d'attente bancaires en Côte d'Ivoire. Ton standard : chaque écran doit pouvoir être présenté au COMEX d'une banque systémique sans une seule retouche, ET être utilisé sans aide par une grand-mère de 70 ans qui n'a jamais touché un écran tactile.

Ces deux exigences ne sont pas en tension — elles convergent : **le design le plus moderne est celui qui disparaît**. Zéro friction, zéro hésitation, zéro apprentissage.

## 2. Les 5 lois du design SIGFA

**Loi 1 — La clarté avant la beauté, et la beauté par la clarté.**
Aucun élément décoratif qui ne serve la compréhension. La modernité vient de l'espace, de la typographie et du mouvement juste — jamais de l'ornement.

**Loi 2 — Le doigt d'abord (kiosque et mobile).**
Tout est conçu pour le toucher : cibles généreuses, retours immédiats, gestes évidents. La souris est le cas secondaire, pas l'inverse.

**Loi 3 — Une décision par écran.**
Chaque écran pose UNE question ou montre UNE information principale. Si un écran demande deux décisions, c'est deux écrans.

**Loi 4 — Le contexte ivoirien est une donnée de design, pas une contrainte.**
Lumière de plein soleil sur les bornes, clients pressés en fin de mois, diversité linguistique (FR/EN — décision PO 2026-07 : Dioula et Baoulé retirés du périmètre), tous niveaux de littératie numérique. Ce terrain façonne chaque choix : contrastes élevés, icônes universelles, voix de synthèse, pictogrammes systématiques.

**Loi 5 — Chaque banque garde son identité, SIGFA garde sa structure.**
Le theming par tenant (logo, couleur primaire, ton) change l'habillage — jamais la disposition, les tailles de cibles, ni les parcours. La qualité UX est non-négociable et identique pour toutes les banques.

---

# PARTIE II — LE SYSTÈME DE DESIGN (TOKENS)

## 3. Fondations visuelles

### Palette structurelle (invariante — le theming banque s'y superpose)

```
FOND & SURFACES
  --surface-0      #FAFBFC   Fond principal clair (dashboard, mobile)
  --surface-1      #FFFFFF   Cartes, panneaux
  --surface-kiosk  #0E1420   Fond kiosque — sombre profond bleuté :
                             lisible en plein soleil, réduit les reflets,
                             fait vibrer la couleur banque
  --surface-screen #0A0F1A   Écran d'appel TV — noir bleuté, contraste max

ENCRE
  --ink-strong     #101828   Texte principal (clair)
  --ink-soft       #475467   Texte secondaire
  --ink-inverse    #F5F7FA   Texte sur fonds sombres
  --ink-muted-inv  #98A2B3   Secondaire sur sombre

FONCTIONNELS (identiques pour toutes les banques — langage universel)
  --success        #12B76A   Ticket confirmé, guichet ouvert
  --warning        #F79009   File chargée, SLA approche
  --danger         #F04438   SLA dépassé, guichet fermé, erreur
  --info           #2E90FA   Information neutre, badge offline

THEMING PAR BANQUE (variables injectées par tenant)
  --brand          {couleur primaire banque}
  --brand-soft     {teinte 10% pour fonds de badges}
  --brand-contrast {blanc ou noir calculé — ratio ≥ 4.5:1 obligatoire}
```

> **Règle du theming** : `--brand` n'apparaît que sur les éléments d'action et d'identité (boutons primaires, numéro de ticket, header). Jamais sur le texte courant, jamais comme fond de page. Si la couleur d'une banque ne passe pas le contraste 4.5:1, le système la fonce automatiquement — la marque s'adapte à l'accessibilité, pas l'inverse.

### Typographie

```
DISPLAY   : "Clash Display" ou "General Sans" (semibold)
            → numéros de tickets, chiffres géants du kiosque et de l'écran TV
BODY      : "Inter" (variable, 400–600)
            → tout le reste : dense, neutre, excellente lisibilité petits corps
MONO      : "JetBrains Mono"
            → horodatages, identifiants techniques (dashboard uniquement)

ÉCHELLE KIOSQUE (base 1.4× l'échelle web — on lit debout, à 60cm)
  ticket-number   : 96–128px  (le héros absolu de l'écran)
  title           : 40px
  action-label    : 28px      (texte des boutons)
  body            : 24px      (minimum absolu kiosque — RIEN en dessous)
  
ÉCHELLE DASHBOARD
  kpi-value : 40px · section-title : 20px · body : 15px · caption : 13px

ÉCHELLE ÉCRAN D'APPEL TV (lu à 5–10 mètres)
  ticket-called   : 180px minimum
  counter-number  : 120px
  file d'attente  : 64px
```

### Espace, forme, profondeur

```
GRILLE      : base 4px · espacements 8/12/16/24/32/48/64
RAYONS      : 12px (cartes) · 16px (boutons kiosque) · 999px (badges, pills)
PROFONDEUR  : 2 niveaux d'ombre max — subtile (cartes) et flottante (modales).
              Sur kiosque : AUCUNE ombre, la hiérarchie vient de la couleur
              et de la taille (les ombres disparaissent en plein soleil)
BORDURES    : 1px #EAECF0 (clair) · 1px rgba(255,255,255,0.08) (sombre)
```

### Mouvement

```
DURÉES     : 150ms (micro : press, hover) · 250ms (transitions d'écran)
             · 400ms (célébration : ticket émis)
COURBE     : cubic-bezier(0.2, 0.8, 0.2, 1) — sortie rapide, arrivée douce
RÈGLES     : le mouvement explique (d'où vient l'écran, où va l'action),
             jamais ne divertit. Toute animation respecte
             prefers-reduced-motion. Sur kiosque : les transitions
             confirment le toucher en <100ms — le retour instantané
             EST le design.
```

---

# PARTIE III — LE KIOSQUE : LE CHEF-D'ŒUVRE

## 4. Vision : "3 touchers, 20 secondes, zéro doute"

Le kiosque est l'interface la plus importante du projet : c'est le premier contact physique du client avec la banque digitalisée. Il doit être **irréprochable**.

**Le parcours nominal complet** :

```
   TOUCHER 1          TOUCHER 2            TOUCHER 3
   Choisir sa    →    Choisir son     →    Confirmer
   langue             service              (ou saisir tel. optionnel)
   (2 sec)            (5 sec)              (3 sec)
                                              │
                                              ▼
                                    🎫 TICKET ÉMIS — écran de
                                    célébration 4 secondes puis
                                    retour accueil automatique
```

### Signature visuelle du kiosque

**Le "Moment Ticket"** : quand le ticket est émis, l'écran entier devient le ticket. Le numéro s'affiche en 128px au centre, la couleur de la banque pulse doucement une fois (400ms), la synthèse vocale annonce *« Ticket A-047. Vous êtes 3ᵉ dans la file. Environ 12 minutes. »* pendant que ces trois informations s'affichent en hiérarchie claire. C'est le seul moment théâtral de l'interface — tout le reste est d'une sobriété absolue. C'est l'élément que les clients retiendront et que les banques montreront en démo.

## 5. Anatomie des écrans kiosque

### Écran 1 — Accueil / Langue

```
┌─────────────────────────────────────────────┐
│  [logo banque]                    14:32     │  ← header discret 64px
│                                             │
│         Akwaba ! Bienvenue                  │  ← 40px, chaleureux
│      Choisissez votre langue                │
│                                             │
│  ┌──────────────┐  ┌──────────────┐        │
│  │   Français    │  │   English    │        │  ← 2 cartes égales
│  └──────────────┘  └──────────────┘        │    min 120px de haut
│                                             │    icône drapeau/motif
│                                             │    + label 28px
│                                             │
│  ● file actuelle : 8 personnes en attente   │  ← honnêteté immédiate
└─────────────────────────────────────────────┘
```

- L'accueil affiche **déjà** l'état de la file — le client sait à quoi s'attendre avant même de commencer
- Chaque carte de langue est aussi un bouton vocal : l'appui déclenche la confirmation parlée dans la langue choisie
- Inactivité 30s → retour à cet écran avec fondu doux

### Écran 2 — Choix du service

```
┌─────────────────────────────────────────────┐
│  ← Retour          Quelle opération ?       │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │ 💵  Dépôt / Retrait / Virement       │   │  ← 1 colonne,
│  │     ~ 8 min d'attente          ›     │   │    cartes pleine
│  └─────────────────────────────────────┘   │    largeur 96px haut
│  ┌─────────────────────────────────────┐   │
│  │ 📂  Ouvrir un compte                 │   │  ← icône 40px +
│  │     ~ 15 min d'attente         ›     │   │    label 28px +
│  └─────────────────────────────────────┘   │    attente estimée
│  ┌─────────────────────────────────────┐   │    EN TEMPS RÉEL
│  │ 🏠  Crédit & financement             │   │
│  │     ~ 22 min d'attente         ›     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│         [ ⌄ voir plus de services ]         │  ← max 4 visibles,
└─────────────────────────────────────────────┘     scroll doux si +
```

**Règles impératives** :
- **Icône + texte, toujours** : jamais l'un sans l'autre (littératie variable)
- **Attente estimée par service, en temps réel** : c'est l'information qui a le plus de valeur pour le client — elle est traitée comme telle
- Maximum **4 services visibles** sans scroll ; les services rares derrière "voir plus"
- Les services PMR/Senior/VIP ne sont pas des choix cachés : un bouton discret "♿ Accès prioritaire" en bas déclenche le parcours adapté (contraste renforcé, voix ralentie, textes +20%)

### Écran 3 — Confirmation + téléphone optionnel

```
┌─────────────────────────────────────────────┐
│  ← Retour                                   │
│                                             │
│   Dépôt / Retrait / Virement               │
│   Environ 8 minutes d'attente               │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  📱  Recevoir l'avancement par SMS   │   │
│  │  ┌───────────────────────────────┐  │   │  ← pavé numérique
│  │  │  07 __ __ __ __              │  │   │    GÉANT plein écran
│  │  └───────────────────────────────┘  │   │    touches 72px min
│  │        (facultatif)                  │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────┐ ┌────────────────┐   │
│  │  Passer  (gris)  │ │ PRENDRE MON    │   │  ← CTA brand,
│  │                  │ │ TICKET  (brand)│   │    pleine hauteur 88px
│  └──────────────────┘ └────────────────┘   │
└─────────────────────────────────────────────┘
```

- Le téléphone est **explicitement facultatif** — le bouton "Passer" est visible, jamais culpabilisant
- Le pavé numérique est natif au kiosque (jamais de clavier système) : touches 72px, retour haptique si le matériel le permet, sonore sinon
- Consentement SMS en une ligne claire sous le champ, pré-lisible, conforme UEMOA

### Écran 4 — Le Moment Ticket (signature)

```
┌─────────────────────────────────────────────┐
│                                             │
│                                             │
│                 A‑047                       │  ← 128px, Display,
│                                             │    couleur brand,
│           Vous êtes 3ᵉ dans la file         │    pulse 1× 400ms
│           Attente estimée : 12 min          │
│                                             │
│      🖨  Votre ticket s'imprime…            │
│      📱  SMS envoyé au 07 •• •• •• 47       │
│                                             │
│         Merci ! Suivez l'écran ↗            │  ← pointe vers
│                                             │    l'écran TV réel
└─────────────────────────────────────────────┘
        + annonce vocale simultanée dans la langue choisie
        + retour accueil automatique après 4 secondes
```

## 6. Les états difficiles — où se joue l'excellence

C'est dans les états dégradés qu'un design est irréprochable ou ne l'est pas :

| État | Design |
|---|---|
| **Hors ligne** | Bandeau info discret en haut : *« Mode hors connexion — vos tickets restent valables »*. Le parcours reste **identique** : le client ne doit percevoir AUCUNE différence de qualité. Le badge disparaît en fondu au retour du réseau. |
| **File très longue** | Honnêteté proactive : *« Forte affluence — environ 45 min. Recevez un SMS et revenez à l'heure de votre passage. »* Le SMS devient l'option mise en avant, pas une punition. |
| **Service fermé** | La carte du service reste visible mais grisée avec l'horaire : *« Ouvre demain à 8h00 »*. Jamais de disparition silencieuse qui ferait douter le client. |
| **Imprimante en panne** | Bascule transparente : le numéro s'affiche plus longtemps (8s), le SMS devient fortement suggéré, message : *« Photographiez votre numéro ou recevez-le par SMS »*. |
| **Erreur système** | Jamais de code d'erreur, jamais d'excuse vague. *« Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous. »* + alerte silencieuse au manager. |
| **Toucher répété/impatient** | Chaque toucher donne un retour <100ms même pendant un chargement — l'écran ne "meurt" jamais sous le doigt. |

## 7. Accessibilité kiosque — plancher non négociable

```
✔ Cibles tactiles ≥ 72×72px, espacement ≥ 16px entre cibles
✔ Contraste ≥ 7:1 sur le kiosque (au-delà de WCAG AA — plein soleil)
✔ Texte minimum 24px, aucune information portée par la couleur seule
✔ Synthèse vocale sur chaque écran (bouton 🔊 permanent + auto au Moment Ticket)
✔ Mode accessibilité : +20% textes, voix ralentie, temps d'inactivité doublé
✔ Hauteur des zones interactives : entre 80cm et 120cm du sol
  (accessible fauteuil roulant — la zone haute de l'écran est informative,
  jamais interactive)
✔ prefers-reduced-motion respecté même en mode kiosque
```

---

# PARTIE IV — LES AUTRES SURFACES

## 8. Écran d'appel TV — lisible à 10 mètres

```
┌───────────────────────────────────────────────────────┐
│  [logo]        APPELS EN COURS              14:32     │
│                                                       │
│   ┌─────────────────────────────────────────────┐    │
│   │                                             │    │
│   │      A‑047      →      GUICHET 3            │    │ ← dernier appel :
│   │       180px             120px               │    │   ZONE HÉROS,
│   │                                             │    │   flash brand 2s
│   └─────────────────────────────────────────────┘    │   + annonce vocale
│                                                       │
│   A‑046 → G1        B‑012 → G4        A‑045 → G2     │ ← 3 précédents, 64px
│                                                       │
│   PROCHAINS : A‑048 · A‑049 · B‑013 · A‑050           │ ← file, défilement
└───────────────────────────────────────────────────────┘   doux si besoin
```

- **Une seule information héros** : le dernier appel. Tout le reste est contexte.
- Nouveau ticket appelé : le héros précédent glisse vers la rangée du bas, le nouveau entre avec un flash de la couleur banque (2s) + double gong sonore + annonce vocale
- Aucune animation en boucle, aucun carrousel publicitaire qui polluerait la lecture — cet écran a UN travail
- Contraste maximal (#0A0F1A / blanc pur), conçu pour des TV bas de gamme mal calibrées

## 9. Dashboard manager & interface agent

### Interface agent — 3 actions, zéro navigation

```
┌─────────────────────────────────────┐
│  Guichet 3 · Aminata K.    ● actif  │
│                                     │
│         TICKET EN COURS             │
│            A‑047                    │  ← 96px
│    Dépôt/Retrait · depuis 3:24      │  ← chrono live
│                                     │
│  ┌───────────┐ ┌──────────────────┐ │
│  │ Transférer │ │    TERMINER     │ │  ← 2 actions max
│  └───────────┘ └──────────────────┘ │     visibles à la fois
│ ─────────────────────────────────── │
│  Suivant : A‑048 (attend 8 min)     │
│  ┌─────────────────────────────────┐│
│  │      APPELER LE SUIVANT         ││  ← l'action reine :
│  └─────────────────────────────────┘│     pleine largeur, brand
└─────────────────────────────────────┘
```

L'agent traite 200 tickets/jour : chaque pixel de friction coûte des heures cumulées. Interface utilisable **sans jamais regarder l'écran plus d'une seconde** — les 3 boutons sont toujours au même endroit, mémorisables musculairement. Raccourcis clavier (Espace = appeler suivant) pour les guichets équipés.

### Dashboard manager — l'état de l'agence en un regard

- **Hiérarchie en Z** : en haut à gauche le chiffre qui compte (TMA temps réel vs objectif SLA, coloré vert/orange/rouge), puis la file par service, puis la grille des agents avec leur statut
- **Le rouge est réservé** : seuls les dépassements SLA et les alertes l'utilisent — s'il y a du rouge à l'écran, il y a une action à faire, toujours
- Sparklines 24h sous chaque KPI (contexte sans encombrement), comparatif discret J-7
- Mode TV : le dashboard se projette en salle de pilotage réseau, typographie ×1.5 automatique

## 10. Application mobile client

- **Le ticket est un objet vivant** : une carte qui occupe l'écran, position dans la file mise à jour en direct, barre de progression vers "c'est votre tour"
- Notifications riches : *« Plus que 2 personnes devant vous — dirigez-vous vers l'agence »* avec temps de trajet estimé si géoloc acceptée
- Prise de ticket à distance : même parcours 3 étapes que le kiosque — cohérence totale des deux canaux
- Widget/Live Activity (iOS) et notification persistante (Android) : la position dans la file visible sans ouvrir l'app

---

# PARTIE V — GOUVERNANCE DU DESIGN

## 11. Intégration dans la méthode agentique

Le design s'intègre dans les boucles de SIGFA_METHODE_CONCEPTION_AGENTIQUE.md :

**Nouvel agent : `design-reviewer`** (panel de vérification, lecture seule)

```markdown
---
name: design-reviewer
description: Vérifie la conformité de toute UI produite au système de
  design SIGFA (ce document). Rejette les écarts de tokens, de tailles
  de cibles, de contraste et de parcours.
model: sonnet
tools: Read, Grep, Glob, Bash
---

Checklist de verdict (chaque item = PASS/FAIL, un FAIL = story REVIEW) :
- [ ] Tokens uniquement : aucune couleur/taille/rayon en dur hors variables
- [ ] Kiosque : cibles ≥72px, texte ≥24px, contraste ≥7:1
- [ ] Dashboard/mobile : contraste ≥4.5:1, cibles ≥44px
- [ ] Un écran = une décision (compter les CTA primaires : max 1)
- [ ] Tous les états conçus : loading, empty, error, offline (T7 lié)
- [ ] Icône + texte appariés sur toute action kiosque
- [ ] i18n : aucun texte en dur, les 2 langues (FR/EN) rendues sans débordement
- [ ] prefers-reduced-motion : chaque animation a son fallback
- [ ] Voix UI : verbes actifs, le bouton dit ce qu'il fait, même nom
      pour la même action sur tout le parcours
- [ ] Theming banque : brand uniquement sur actions/identité,
      contraste auto-corrigé
```

**Stories de design dans le PRD** : chaque écran majeur a une story `DESIGN-xxx` en amont de sa story d'implémentation dans le DAG — wireframe + états + copie validés par gate humain avant que l'agent d'exécution ne code.

**Tests visuels automatisés** (s'ajoute au gate 9 étapes) :
- Regression visuelle par screenshots (Playwright) sur les écrans clés dans les 2 langues (FR/EN)
- Audit de contraste automatisé (axe-core) — build rouge si un ratio passe sous le plancher
- Test de débordement i18n : les libellés FR/EN les plus longs ne cassent aucun layout

## 12. La copie est du design

Registre SIGFA : **chaleureux, direct, jamais bureaucratique**.

| ❌ Interdit | ✅ SIGFA |
|---|---|
| « Veuillez patienter, votre requête est en cours de traitement » | « Un instant… » |
| « Soumettre » | « Prendre mon ticket » |
| « Erreur 502 — service indisponible » | « Un problème est survenu. Adressez-vous à l'accueil, on s'occupe de vous. » |
| « Votre ticket a été généré avec succès » | « Ticket A‑047 — vous êtes 3ᵉ » |
| « Champ obligatoire manquant » | « Il manque votre numéro — ou touchez Passer » |

Règles : le bouton dit exactement ce qui va se passer · la même action garde le même nom sur tout le parcours (« Prendre mon ticket » → SMS « Votre ticket A-047 ») · les erreurs disent quoi faire, jamais qui est fautif · « Akwaba » et le ton ivoirien sont les bienvenus là où ils créent de la chaleur, jamais là où ils coûtent de la clarté.

## 13. Anti-patterns design — bannis

| Anti-pattern | Pourquoi c'est banni |
|---|---|
| Carrousel/pub sur le kiosque ou l'écran TV | Ces écrans ont UN travail ; toute distraction dégrade le temps de décision |
| Dégradés décoratifs, glassmorphism, ombres multiples | Illisible en plein soleil, vieillit mal, ralentit le rendu des bornes modestes |
| Texte < 24px sur kiosque, < 13px ailleurs | Plancher absolu, aucune exception "parce que ça rentre pas" |
| Couleur seule pour porter une information | Daltonisme + écrans mal calibrés : toujours couleur + icône + texte |
| Skeleton screens de plus de 400ms sans message | Au-delà, on dit ce qui se passe en mots |
| Modale sur le kiosque | Une modale = une décision de plus = un écran ; le kiosque navigue, il n'empile pas |
| Hamburger menu sur l'interface agent | 3 actions max, toutes visibles — rien n'est jamais caché |
| Theming banque qui touche à la structure | La couleur change, la grille/les tailles/les parcours JAMAIS |
| Animation "wow" gratuite | Le seul moment théâtral autorisé est le Moment Ticket |

---

## 14. Definition of Done — Design

Un écran est terminé quand :

- [ ] Il respecte 100% des tokens (vérifié par design-reviewer)
- [ ] Ses 5 états existent : nominal, loading, empty, error, offline
- [ ] Il passe l'audit de contraste automatisé dans les 2 langues (FR/EN)
- [ ] Le parcours a été testé au doigt sur écran tactile réel (pas seulement en simulateur)
- [ ] La copie suit le registre SIGFA et la synthèse vocale a été écoutée
- [ ] Un utilisateur non-initié accomplit la tâche sans aide en moins de 30 secondes (test de couloir, 3 personnes minimum pour les écrans kiosque)
- [ ] Screenshot de référence commité pour la régression visuelle

---

*Système de Design SIGFA v1.0 · Le design le plus moderne est celui qui disparaît · 3 touchers, 20 secondes, zéro doute*
