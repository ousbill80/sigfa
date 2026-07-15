# SIGFA — SYSTÈME DE DESIGN v3 · « Neutre Premium »

> **Version** : 3.0 · **2026-07-14** · Supplante la v2 « Or & Forêt » (palette rejetée par le PO : le mariage terracotta / vert forêt / or patiné / fonds brun-nuit est jugé très mauvais).
> **Source de vérité unique.** Les tokens vivent dans `packages/ui/src/tokens.css` (miroir JS : `tokens.ts`) ; **aucune valeur hex hors des tokens**.
> Tous les ratios de contraste ci-dessous sont **mesurés** avec `packages/ui/src/lib/contrast.ts` (WCAG 2.1) et **verrouillés par les tests** (`tokens.test.ts`, `contrast.test.ts`, `bank-theme.test.ts`).

---

## 0. Le parti-pris : « Neutre Premium »

Châssis neutre haut de gamme, type fintech premium / banque privée (Linear, Vercel, Revolut Business) : surfaces et encre en **neutres purs** (plus aucune teinte brune ou beige), profondeur douce, typographie soignée.

**La couleur de la banque (`--brand`) est le SEUL accent chromatique.** Chaque banque tenante se brande sans effort en surchargeant une seule couleur ; tout le reste du système est achromatique ou sémantique standard. Conséquences :

1. **Neutralité** — le produit ne porte aucune identité chromatique propre qui entrerait en conflit avec celle du tenant.
2. **Calme** — hiérarchie évidente, zéro bruit visuel ; le regard va vers l'accent brand, et lui seul.
3. **Craft** — les acquis v2 restent : typo General Sans / Clash Display, échelle 1.25, radius 8/12/18/28, durées 120/220/360 ms, `prefers-reduced-motion`.

Anti-patterns bannis : les teintes chaudes « décoratives » (terracotta, or, brun-nuit), les ombres teintées, tout second accent chromatique fixe, le texte gris sur gris, les hex hors tokens.

---

## 1. Couleur — palette v3

### Encre & surfaces (neutres purs)
```
--paper            #FAFAFA   Fond app
--surface-1        #FFFFFF   Cartes (élévation sur paper)
--surface-2        #F5F5F5   Sections alternées, champs au repos
--hairline         #E5E5E5   Séparateurs 1px
--ink              #0A0A0A   Texte principal — 18.97:1 sur paper
--ink-soft         #525252   Texte secondaire — 7.49:1 sur paper, 7.17:1 sur surface-2
--ink-faint        #A3A3A3   Placeholder, métadonnées (jamais texte porteur)

SOMBRE (kiosque plein soleil + écran d'appel TV)
--night            #0A0A0A   Fond kiosque
--night-2          #050505   Écran TV — contraste max
--ink-inverse      #FAFAFA   18.97:1 sur night · 19.53:1 sur night-2
--ink-inverse-soft #A3A3A3   7.85:1 sur night · 8.08:1 sur night-2 (seuil ≥ 7:1)
```
Toute la rampe est strictement achromatique (R = G = B), verrouillé par test.

### Marque — SEUL accent chromatique (surchargeable par tenant)
```
--brand            var(--tenant-brand, #1D4ED8)
                   Bleu profond, REPLI PRODUIT — chaque banque le remplace.
                   Blanc dessus : 6.70:1 mesuré (seuil ≥ 4.5:1).
--brand-strong     color-mix(brand 70%, noir) → #143797 par défaut
                   Hover / pressed + libellés d'action kiosque : 10.38:1 sur surface-1 (seuil ≥ 7:1).
--brand-soft       color-mix(brand 10%, blanc) → #E8EDFB par défaut
                   Fonds de badge, surbrillance douce : --ink dessus 16.91:1.
--brand-contrast   #FFFFFF par défaut — texte sur brand, blanc/noir auto (≥ 4.5:1), recalculé par le provider.
--brand-inv        color-mix(brand 50%, blanc) → #8EA7EC par défaut   [NOUVEAU v3]
                   Brand éclairci pour fonds sombres (numéro de ticket TV/kiosk) :
                   8.38:1 sur night · 8.63:1 sur night-2 (seuil ≥ 7:1).
```

`deriveBankTheme(brandHex)` (`packages/ui/src/theme/bank-theme.ts`) recalcule les cinq tokens en JS, WCAG-safe et déterministe, pour TOUT brand tenant :
- `brandStrong` : assombrissement itératif jusqu'à ≥ 7:1 sur blanc ;
- `brandSoft` : même teinte à ~92 % de clarté (≈ 8-10 % de brand sur blanc), porte `--ink` ≥ 4.5:1 ;
- `brandContrast` : blanc ou noir, le meilleur des deux (≥ 4.5:1 prouvé sur la suite banques + cas limites) ;
- `brandInv` : **éclaircissement itératif** (luminance relative WCAG, même teinte/saturation) jusqu'à ≥ 7:1 sur `--night` — ce qui implique ≥ 7:1 sur `--night-2`, plus sombre. Cas limites testés : brand quasi noir, quasi blanc, saturé.

`BankThemeProvider` injecte les cinq variables (`--tenant-brand` + dérivés). Sans `brandColor`, il n'injecte rien : le repli produit reste pixel-perfect.

### Sémantiques (sobres, standards)
```
--success       #15803D   4.81:1 sur paper · 5.02:1 sur surface-1
--success-soft  #DCFCE7   success dessus 4.57:1 · ink 18.03:1
--warning       #B45309   4.81:1 sur paper · 5.02:1 sur surface-1
--warning-soft  #FEF3C7   warning dessus 4.51:1
--danger        #DC2626   4.63:1 sur paper · 4.83:1 sur surface-1 — pastille, jamais fond plein
--danger-soft   #FFF5F5   danger dessus 4.51:1
--info          #0369A1   5.68:1 sur paper · 5.93:1 sur surface-1
--info-soft     #E0F2FE   info dessus 5.17:1
```
Note d'implémentation : la spec v3 proposait `#16A34A` / `#D97706` comme point de départ pour success/warning ; mesurés à 3.16:1 et 3.05:1 sur `--paper`, ils cassaient le seuil texte ≥ 4.5:1 (badges, deltas KPI). Ils sont fixés un cran plus sombre (`#15803D`, `#B45309`) — même famille, même sobriété, seuils tenus.

### Sémantiques inverses (texte sur `--night` / `--night-2`, seuil ≥ 7:1)
```
--success-inv   #4ADE80   11.36:1 / 11.70:1
--warning-inv   #FBBF24   11.86:1 / 12.21:1
--danger-inv    #FCA5A5   10.43:1 / 10.74:1
--info-inv      #38BDF8    9.24:1 /  9.51:1
```

### Alias v2 retirés
Les anciens `--forest*`, `--gold*` et `--shadow-gold` ont été **supprimés** après migration des surfaces (web, kiosk, TV). Utiliser `--success*`, `--brand-inv` / `--brand-soft`, et `--shadow-brand-glow`.

---

## 2. Élévation & focus

```
--shadow-1   0 1px 2px rgba(0,0,0,.05), 0 1px 3px rgba(0,0,0,.04)
--shadow-2   0 4px 12px rgba(0,0,0,.07), 0 2px 4px rgba(0,0,0,.04)
--shadow-3   0 12px 32px rgba(0,0,0,.10), 0 4px 8px rgba(0,0,0,.05)
--shadow-brand        0 8px 24px color-mix(brand 22%, transparent)   (bouton primaire, suit le tenant)
--shadow-brand-glow   0 0 48px color-mix(brand-inv 30%, transparent) (Moment Ticket / célébration TV)
```
Ombres **neutres** (noir pur à faible alpha) — plus d'ombres brunes ni dorées.

```
--focus-ring           0 0 0 3px var(--brand-soft), 0 0 0 5px var(--brand)
--focus-ring-inverse   0 0 0 3px color-mix(brand-inv 35%, transparent), 0 0 0 5px var(--brand-inv)
```

---

## 3. Typo, espacements, radius, mouvement — INCHANGÉS (v2 conservée)

- Polices : `--font-display` Clash Display · `--font-text` General Sans · `--font-mono` (codes/audit). Swap par simple surcharge des tokens.
- Échelle modulaire 1.25, base 16 ; `--display` 76 px = numéro de ticket kiosque.
- Radius : 8 / 12 / 18 / 28 / full. Espacement base 4. Durées 120 / 220 / 360 ms, `--ease` unique, repli `prefers-reduced-motion`.

---

## 4. Composants (`components.css`, classes `.sig-*`)

API (props/variants) **inchangée**. Repasse v3 :
- ombres neutres partout, states hover/active/focus sobres ;
- badges : texte sémantique sur fond `-soft` neutre pâle (ratios § 1) ; danger reste pastille/contour, jamais fond plein ;
- **TicketMoment** : le halo doré devient un halo `--brand` discret (`color-mix` faible alpha), le numéro passe en `--brand-inv` (≥ 7:1 garanti sur night/night-2 pour tout tenant) ;
- stepper : étape achevée sur `--success` (plus de `--forest`) ;
- voile de dialogue : `color-mix(--night 45%, transparent)` (plus de brun).

---

## 5. Règles absolues

1. **Aucun hex hors** `tokens.css` / `tokens.ts`. Les composants ne référencent que `var(--token)`.
2. **Un seul token tenant** : `--tenant-brand` (via `BankThemeProvider`). La structure ne change jamais.
3. Seuils de contraste **prouvés par les tests**, jamais déclarés : web ≥ 4.5:1 (texte normal), surfaces sombres kiosk/TV ≥ 7:1.
4. Aucun emoji (lint `sigfa/no-emoji`) ; icônes = set SIGFA duotone.
5. Aucun retour des tokens v2 Or & Forêt (`--forest*`, `--gold*`, `--shadow-gold`) — palette Neutre Premium uniquement.
