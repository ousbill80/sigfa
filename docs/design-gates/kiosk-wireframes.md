# SIGFA Kiosk — Wireframes Design-Gate (KIOSK-002 à 005)

> Wireframes ASCII pour validation humaine avant implémentation.
> Règles de design : cibles ≥ 72 px · texte ≥ 24 px (labels actions 28 px) · contraste ≥ 7:1 · tokens CSS uniquement · 4 langues · 5 états par écran.
> **Ce fichier doit recevoir le label PR `design-approved` avant que agent-kiosk puisse implémenter KIOSK-002.**

---

## KIOSK-002 — Écran Accueil / Choix de Langue

> 4 cartes de langue égales · état de file en bas · timeout 30 s · 5 états

### État Nominal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ╔═════════════════════════════════════════════════════════════════════╗   │
│  ║         S I G F A  — Banque Nationale de Développement             ║   │
│  ║              logo tenant (--tenant-brand)                           ║   │
│  ╚═════════════════════════════════════════════════════════════════════╝   │
│                                                                             │
│        AKWABA — BIENVENUE — BISIMILA — MIAN SU                             │
│        [titre 40 px, centré, --ink-inverse]                                │
│                                                                             │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌──────┐ │
│   │                 │  │                 │  │                 │  │      │ │
│   │   🇫🇷 Drapeau   │  │   🟦 Motif CI   │  │  ✦ Motif CI    │  │ 🌍   │ │
│   │                 │  │                 │  │                 │  │      │ │
│   │   Français      │  │    Dioula       │  │    Baoulé       │  │  EN  │ │
│   │  [28 px bold]   │  │  [28 px bold]   │  │  [28 px bold]   │  │[28px]│ │
│   │                 │  │                 │  │                 │  │      │ │
│   │  min 120 px H   │  │  min 120 px H   │  │  min 120 px H   │  │120px │ │
│   │  cible ≥72px    │  │  cible ≥72px    │  │  cible ≥72px    │  │≥72px │ │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘  └──────┘ │
│   [--surface-1 bg]     [--surface-1 bg]     [--surface-1 bg]   [--surface-1]│
│   [espacmt 16px]       [espacmt 16px]       [espacmt 16px]                  │
│                                                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  📊 File d'attente : 12 personnes — attente estimée : 18 min       │   │
│  │  [--ink-soft, 20 px, icône + texte, centré, toujours visible]      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [Fond : --surface-kiosk (#0E1420)]                                         │
│  Timeout 30 s → fondu retour sur cet écran                                  │
└─────────────────────────────────────────────────────────────────────────────┘
Taille : plein écran 1080×1920 px (portrait) ou 1920×1080 px (paysage)
```

### État Loading (boot / reconnexion)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    [fond --surface-kiosk]                                   │
│                                                                             │
│                         logo SIGFA centré                                  │
│                                                                             │
│              ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                        │
│              [barre de chargement --brand, 8 px H]                          │
│                                                                             │
│              Chargement... / Loading... [20 px --ink-muted-inv]             │
│                                                                             │
│         (reduced-motion : spinner statique, pas de barre animée)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Empty (aucun service disponible)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│              [icône calendrier 64 px --ink-muted-inv]                      │
│                                                                             │
│         L'agence est actuellement fermée.                                   │
│         The agency is currently closed.                                     │
│         [24 px, --ink-inverse, centré]                                      │
│                                                                             │
│         Horaires : Lun–Ven 08h00–17h00                                      │
│         [20 px, --ink-soft]                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Error (session expirée / erreur critique)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  ⚠️  Borne temporairement indisponible                              │  │
│   │  [--danger, 24 px, fond rgba(--danger, 0.1), border-left 4px]       │  │
│   │  Reconnexion automatique en cours...                                 │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   [cartes de langue grisées mais toujours visibles pour navigation offline] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Offline (réseau coupé)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  🔵  Mode hors connexion — vos tickets restent valables            │   │
│  │  [--info, 20 px, discret, haut de l'écran, ne bloque pas la nav]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   [4 cartes de langue ACTIVES — sélection langue toujours possible]         │
│   [état file masqué ou "N/A" si socket coupé]                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## KIOSK-003 — Écran Services

> Cartes icône+texte+attente temps réel · max 4 visibles · accès prioritaire ♿

### État Nominal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ◀  Retour         [logo tenant]          🇫🇷 FR [28 px --ink-inverse]    │
│                                                                             │
│  Quel service souhaitez-vous ? [32 px bold --ink-inverse]                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  💰  Retrait / Dépôt             ~  8 min    [estimation temps réel]│   │
│  │  [icône 40 px]  [label 28 px]    [--ink-soft 20 px]                 │   │
│  │  [min 96 px H, cible ≥ 72 px, contraste ≥ 7:1]                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  📋  Ouverture de compte                 ~ 22 min                  │   │
│  │  [icône 40 px]  [label 28 px]    [--ink-soft 20 px]                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  💳  Carte bancaire                      ~  5 min                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  📞  Réclamation / Assistance            ~ 15 min                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [Bouton "voir plus de services" — visible seulement si > 4 services]       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ↓  Voir plus de services [28 px, centré, --brand, 72 px H]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │  ♿  Accès prioritaire (PMR / Senior)  [bas de l'écran, toujours    │ │
│  │  visible, 24 px, --ink-soft, discret, jamais le focus par défaut]   │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Service CLOSED (grisé)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  💸  Virement international        🔒  Fermé — ouvre lundi 08h00  │
  │  [icône 40 px, opacité 0.4]  [label 28 px, --ink-muted-inv]        │
  │  [non cliquable, curseur default, jamais de disparition silencieuse]│
  └─────────────────────────────────────────────────────────────────────┘
```

### État Empty (aucun service actif)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│              [icône store-off 64 px --ink-muted-inv]                       │
│                                                                             │
│         Aucun service disponible en ce moment.                              │
│         Rendez-vous à l'accueil — un agent vous aidera.                    │
│         [24 px, --ink-inverse, centré, message humain]                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Mode Accessibilité ♿ (après activation)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [textes +20% → label 34 px, estimation 24 px]                              │
│  [contraste renforcé --ink-inverse sur --surface-kiosk strictement]         │
│  [délai inactivité doublé → 60 s au lieu de 30 s]                           │
│  [voix lente : SpeechSynthesis rate 0.7]                                    │
│  [icône ♿ en surbrillance --brand en haut à droite, toujours visible]      │
│                                                                             │
│  [structure identique à l'état nominal — pas de mise en page différente]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Offline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [bandeau --info discret en haut : Mode hors connexion]                     │
│                                                                             │
│  [cartes de service affichées avec dernière estimation connue]               │
│  [estimation marquée "~" et grisée pour indiquer incertitude]               │
│  [bouton ♿ toujours actif]                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## KIOSK-004 — Écran Confirmation / Prise de Ticket

> Pavé numérique natif ≥ 72 px · téléphone facultatif · consentement UEMOA · CTA 88 px

### État Nominal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ◀  Retour    [service choisi : "Retrait / Dépôt"]   🇫🇷 FR               │
│                                                                             │
│  Votre numéro de téléphone (facultatif) [24 px --ink-inverse]               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  🇨🇮 +225  │  07 __ __ __ __ __                [champ natif]      │   │
│  │  [auto-préfixe CI, format E.164, 24 px]                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───┐ ┌───┐ ┌───┐   [Pavé numérique NATIF — jamais clavier OS]            │
│  │ 1 │ │ 2 │ │ 3 │   [touches ≥ 72×72 px, espacement ≥ 16 px]             │
│  └───┘ └───┘ └───┘   [retour sonore < 100 ms si pas de haptique]           │
│  ┌───┐ ┌───┐ ┌───┐                                                         │
│  │ 4 │ │ 5 │ │ 6 │                                                         │
│  └───┘ └───┘ └───┘                                                         │
│  ┌───┐ ┌───┐ ┌───┐                                                         │
│  │ 7 │ │ 8 │ │ 9 │                                                         │
│  └───┘ └───┘ └───┘                                                         │
│         ┌───┐                                                               │
│         │ 0 │                                                               │
│         └───┘                                                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ☐  J'accepte de recevoir mon ticket par SMS (optionnel)           │   │
│  │  [consentement SMS clair, UEMOA, 20 px, visible seulement si tel.] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │        ✔  PRENDRE MON TICKET                                       │   │
│  │  [fond --brand, label 28 px --ink-inverse bold, hauteur 88 px]      │   │
│  │  [cible pleine largeur, toujours visible]                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │             Passer (sans numéro de téléphone)                       │   │
│  │  [28 px, --ink-soft, fond neutre grisé, hauteur 72 px]              │   │
│  │  [prominent, jamais culpabilisant]                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Error (numéro invalide)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  ⚠  Il manque votre numéro — ou touchez Passer                    │
  │  [inline, --danger, 20 px, sous le champ téléphone]                │
  │  [CTA "Prendre mon ticket" reste actif, non bloquant]              │
  └─────────────────────────────────────────────────────────────────────┘
```

### État Loading (POST /public/tickets en cours)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  [CTA : spinner --brand centré, label masqué]                      │
  │  [pavé numérique désactivé pendant la requête]                     │
  │  [timeout max 5 s puis bascule offline automatique]                │
  └─────────────────────────────────────────────────────────────────────┘
```

### État Offline (réseau coupé — useOfflineTicket)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │  🔵  Mode hors connexion — ticket local généré                     │
  │  [bandeau --info discret, 20 px, ne bloque jamais le parcours]     │
  │  [useOfflineTicket() génère numéro local → navigation KIOSK-005]  │
  └─────────────────────────────────────────────────────────────────────┘
```

### État Empty (N/A — non applicable pour cet écran)

```
  Cet écran n'a pas d'état "empty" — il est toujours affiché avec le CTA.
  L'état "service fermé" est géré en amont (KIOSK-003).
```

---

## KIOSK-005 — Le Moment Ticket

> displayNumber 128 px · pulse brand unique 400 ms · voix · impression · retour auto 4 s

### État Nominal (ticket émis, impression OK)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    [fond --surface-kiosk #0E1420]                          │
│                                                                             │
│                         logo tenant [centré, top]                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │                         A  0  0  7                                  │   │
│  │          [displayNumber 128 px Display, --brand, centré]            │   │
│  │          [pulse 400 ms cubic-bezier(0.2,0.8,0.2,1) — UNE SEULE     │   │
│  │           fois au premier affichage, jamais en boucle]              │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│          Position dans la file : 4e [40 px, --ink-inverse, centré]         │
│          Attente estimée : 12 minutes [40 px, --ink-inverse, centré]        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  🖨  Votre ticket s'imprime...                                      │   │
│  │  [--success, 24 px, icône imprimante, visible si printerStatus OK] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  📱  SMS envoyé au 07 •• •• •• 47                                  │   │
│  │  [--success, 20 px, visible SEULEMENT si phoneNumber + smsConsent] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│          Retour automatique dans 4 s ●●●● [compte à rebours discret]       │
│          [--ink-muted-inv, 20 px]                                           │
│                                                                             │
│          [Annonce vocale Web Speech API : numéro + position + attente       │
│           dans la langue de session — déclenchée automatiquement]           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
Retour automatique vers KIOSK-002 après 4 s (8 s en mode accessibilité)
```

### État Reduced-Motion (prefers-reduced-motion: reduce)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         A  0  0  7                                          │
│          [128 px Display --brand — APPARITION STATIQUE, zéro animation]    │
│          [contenu identique à l'état nominal]                               │
│          [aucun pulse, aucune transition]                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Error (impression en échec)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         A  0  0  7  [128 px --brand]                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ⚠  Imprimante indisponible — un agent vous remettra votre ticket  │   │
│  │  [--warning, 24 px, icône alerte, remplacement humain digne]        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│          [Retour auto 4 s — identique état nominal]                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Offline (ticket local généré par useOfflineTicket)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [bandeau --info discret : "Mode hors connexion — ticket temporaire"]        │
│                                                                             │
│                         A  0  0  7  [128 px --brand]                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ℹ  Ticket local — synchronisation dès reconnexion                 │   │
│  │  [--info, 20 px]                                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│          [pas de message SMS — smsConsent non transmis en offline]          │
│          [Retour auto 4 s — identique état nominal]                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### État Loading (soumission ticket en cours — transition depuis KIOSK-004)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│              [fond --surface-kiosk — écran vide intentionnel]              │
│              [spinner --brand centré, 64 px]                               │
│              [pas de texte — silence = rapidité attendue]                  │
│              [timeout 5 s max, puis bascule offline ou erreur]             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Checklist Design-Gate (à compléter par le reviewer humain)

Avant que agent-kiosk puisse implémenter KIOSK-002 à 005, le reviewer doit valider :

### KIOSK-002
- [ ] Copie "Akwaba" validée — présent en FR et EN uniquement
- [ ] 4 cartes de langue identifiées visuellement (iconographie validée)
- [ ] État de file dans le footer (position + contenu)
- [ ] Timeout 30 s / 60 s accessibilité accepté
- [ ] Bandeau offline approuvé (couleur --info, non bloquant)

### KIOSK-003
- [ ] Max 4 services visibles — bouton "voir plus" validé (libellé + style)
- [ ] Icônes de services approuvées (bibliothèque d'icônes)
- [ ] Présentation attente estimée (format minutes, temps réel)
- [ ] Service CLOSED grisé avec horaire — design approbation
- [ ] Bouton ♿ discret validé (position, libellé, couleur)

### KIOSK-004
- [ ] Pavé numérique natif approuvé (disposition 3×3+0, sans clavier OS)
- [ ] Bouton "Passer" — libellé exact et positionnement validés
- [ ] Libellé consentement SMS validé (conformité UEMOA)
- [ ] CTA "PRENDRE MON TICKET" — libellé exact validé en 4 langues
- [ ] État error inline validé (message et couleur)

### KIOSK-005
- [ ] "Le Moment Ticket" — displayNumber 128 px approuvé
- [ ] Pulse 400 ms : courbe et durée validées
- [ ] Annonce vocale : script approuvé en 4 langues
- [ ] Message imprimante OK (--success) / HS (--warning) validés
- [ ] Masquage téléphone "07 •• •• •• 47" validé
- [ ] Retour 4 s / 8 s accessibilité confirmé

**Label PR requis : `design-approved`** — sans ce label, agent-kiosk ne peut pas ouvrir de PR pour KIOSK-002 à 005.
