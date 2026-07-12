# SIGFA — SYSTÈME DE DESIGN v2 · « Sérénité Premium »

> **Version** : 2.0 · **2026-07-12** · Refonte complète (directive PO : l'UX/UI doit être IRRÉPROCHABLE — l'expérience client est la raison d'être du produit).
> Remplace la palette générique v1 (Untitled-UI standard, sans personnalité) par une identité propre à SIGFA.
> **Source de vérité unique.** Les tokens vivent désormais dans `packages/ui` (partagé) ; aucune valeur hex hors des tokens.

---

## 0. Le parti-pris : « Sérénité Premium »

Un client qui prend un ticket dans une banque est souvent **pressé, anxieux, parfois intimidé par la technologie**. Notre design a UN travail émotionnel : **transformer l'attente en tranquillité**. Et le même produit doit se présenter au **COMEX d'une banque systémique** comme un objet de luxe technologique.

Trois qualités, non négociables, à tenir simultanément :
1. **Calme** — respiration, hiérarchie évidente, zéro bruit visuel. On sait où regarder en 1 seconde.
2. **Chaleur** — une identité ivoirienne premium (terre, or, forêt) qui humanise, jamais froide ni corporate-générique.
3. **Craft** — profondeur douce, typographie soignée, mouvement juste. Chaque pixel est intentionnel. C'est ce « craft » qui manquait à la v1.

Anti-patterns bannis : le bleu SaaS générique `#1570ef`, les ombres dures noires, les coins ni-ronds-ni-carrés hésitants, le texte gris sur gris, les états plats sans feedback, les écrans « formulaire nu ».

---

## 1. Couleur — palette propriétaire

### Encre & surfaces (base chaude, jamais du gris clinique)
```
--paper           #FBF8F3   Fond principal clair — blanc CHAUD (papier ivoire), pas #FAFBFC froid
--surface-1       #FFFFFF   Cartes (élévation sur paper)
--surface-2       #F4EEE4   Sections alternées, champs au repos (beige très clair)
--ink             #1A130C   Texte principal — brun-noir chaud (pas #101828 bleuté)
--ink-soft        #6B5D4F   Texte secondaire — taupe chaud
--ink-faint       #A99C8B   Placeholder, métadonnées
--hairline        #ECE3D6   Séparateurs 1px (jamais de gris pur)

SOMBRE (kiosque plein soleil + écran d'appel TV)
--night           #16110B   Fond kiosque — brun-nuit profond (vibre l'or, mange les reflets)
--night-2         #0E0A06   Écran TV — contraste max
--ink-inverse     #FBF6EE   Texte sur sombre — blanc chaud
--ink-inverse-soft#B8AB98   Secondaire sur sombre
```

### Marque SIGFA — « Or & Forêt » (identité ivoirienne premium)
```
--brand           #C25A16   TERRACOTTA/AMBRE brûlé — chaleur, terre, énergie (primaire produit)
--brand-strong    #9C400C   Pressé / hover
--brand-soft      #F7E7D6   Fonds de badge, surbrillance douce
--brand-contrast  #FFFFFF   Texte sur brand (ratio ≥ 4.5:1 vérifié)

--forest          #0F6B4A   VERT FORÊT profond — confiance, positif, « ouvert »/« servi »
--forest-soft     #DBEFE6
--gold            #C79A3A   OR patiné — accents premium, jalons, récompense (feedback 5★)
--gold-soft       #F6ECD2
```
> Le theming banque surcharge `--brand` (couleur du tenant) MAIS `--forest`/`--gold` restent (langage fonctionnel SIGFA). `--brand-contrast` recalculé (WCAG ≥ 4.5:1). La STRUCTURE ne change jamais (Loi 5 v1 conservée).

### Sémantiques (fonctionnels — harmonisés à la palette chaude)
```
--success  #0F7A4D   guichet ouvert, ticket confirmé (= forest, cohérent)
--warning  #C77D0A   file chargée, SLA approche (ambre, pas orange criard)
--danger   #C0362C   SLA dépassé, erreur (rouge terre, jamais fluo — pictogramme SEULEMENT, jamais un fond)
--info     #2C6E9B   information neutre, offline (bleu ardoise doux, pas #2E90FA fluo)
```

## 2. Typographie — du caractère, lisible en plein soleil

- **Display / titres** : `"Clash Display"` ou `"General Sans"` (Fontshare, licence libre) — grotesque moderne à personnalité, pour les grands nombres de ticket et titres. Fallback : `"Sohne", system-ui`.
- **Texte / UI** : `"General Sans"` ou `"Inter Tight"` — neutre chaud, excellente lisibilité multilingue (FR/EN).
- **Chiffres de ticket** : chiffres tabulaires, graisse 600-700, `letter-spacing: -0.02em`.

Échelle (modulaire 1.25, base 16 ; ×1.5 en mode TV, +20% en mode accessibilité) :
```
--text-xs 12 · --text-sm 14 · --text-md 16 · --text-lg 20 · --text-xl 25
--text-2xl 31 · --text-3xl 39 · --text-4xl 49 · --display 76 (numéro de ticket kiosque)
```
Corps : `line-height: 1.55` ; titres : `1.15`, `letter-spacing: -0.015em`. Kiosque : texte ≥ 24px, cibles ≥ 72px, contraste ≥ 7:1 (inchangé, non négociable).

## 3. Forme, profondeur, mouvement (le « craft »)

**Rayons** (assumés, cohérents — fin du « ni rond ni carré ») :
```
--r-sm 8 · --r-md 12 (champs, boutons) · --r-lg 18 (cartes) · --r-xl 28 (feuilles, moments forts) · --r-full 999
```
**Élévation** — ombres CHAUDES et douces (teintées brun, jamais noir pur), en couches :
```
--shadow-1  0 1px 2px rgba(26,19,12,.06), 0 1px 3px rgba(26,19,12,.05)
--shadow-2  0 4px 12px rgba(26,19,12,.08), 0 2px 4px rgba(26,19,12,.05)
--shadow-3  0 12px 32px rgba(26,19,12,.12), 0 4px 8px rgba(26,19,12,.06)
--shadow-brand 0 8px 24px rgba(194,90,22,.28)   (bouton primaire au repos = présence)
```
**Espacement** — base 4, généreux : 4/8/12/16/24/32/48/64/96. Respiration = signal premium n°1.

**Mouvement** — juste, jamais gratuit :
```
--ease   cubic-bezier(.2,.7,.2,1)      (entrée/sortie naturelle)
--dur-1 120ms (feedback tactile) · --dur-2 220ms (transitions d'état) · --dur-3 360ms (entrée d'écran)
```
Toucher → réponse < 100ms (scale .98 + assombrissement). Apparition de carte → fondu + translation 8px. `prefers-reduced-motion` → instantané. Le numéro de ticket au « Moment Ticket » : entrée avec un léger « spring » + halo `--gold`.

## 4. Composants canoniques (à reconstruire dans `packages/ui`)

Chaque composant : 5 états (repos / survol / actif-pressé / focus-clavier / désactivé) + variantes taille (kiosk 72px, dense web).
- **Button** : primary (fond `--brand` + `--shadow-brand`), secondary (contour `--ink` léger), ghost, danger (contour, jamais fond rouge). Icône + label appariés.
- **Card / Surface** : `--surface-1`, `--r-lg`, `--shadow-1` (hover `--shadow-2` + translation -2px).
- **ServiceCard** (kiosque) : icône généreuse, label 28px, temps d'attente, état (ouvert/fermé grisé). Cible ≥ 72px.
- **TicketMoment** : le héros — numéro `--display` sur night, halo gold, message SIGFA, actions SMS/voix.
- **Input / Field** : `--surface-2` au repos, focus = anneau `--brand` 3px + `--surface-1`. Erreur inline sous le champ (jamais de modale).
- **Badge / StatusPill** : success/warning/danger/info + brand-soft. `--danger` = pastille/pictogramme, jamais fond plein.
- **KpiTile** (dashboards) : valeur `--text-4xl` tabulaire, label discret, delta coloré, sparkline optionnelle.
- **StatBar, Toast, Dialog, Skeleton, EmptyState, OfflineBanner (`--info` doux), Stepper (onboarding)**.

## 5. Règles d'application par surface
- **Kiosque** : fond `--night`, une décision/écran, or qui vibre, immense lisibilité, voix. C'est l'écran de l'EXPÉRIENCE CLIENT → le plus soigné.
- **Web dashboards** : fond `--paper`, densité maîtrisée, `--surface-1` en cartes, hiérarchie par typo+espace (pas par bordures). Doit impressionner un COMEX.
- **TV/écran d'appel** : `--night-2`, numéro géant, dernier appelé en `--brand`, historique en retrait.
- **Mobile** : `--paper`, pouce d'abord, ticket vivant = héros.

## 6. Processus qualité (non négociable)
Refonte pilotée par **revue VISUELLE du rendu réel** (captures d'écran), pas par wireframe ASCII. Chaque écran refondu passe `design-reviewer` sur capture, + accessibilité (contraste, cibles, focus clavier, reduced-motion), + les 5 états. Le PO valide la direction sur l'écran phare (prise de ticket) AVANT généralisation.

## 7. Fondation technique
Design system centralisé dans **`packages/ui`** : `tokens.css` (source hex unique), primitives React (Button, Card, Field, Badge, KpiTile…), utilitaires (contraste WCAG, scale accessibilité/TV). Les apps (web/kiosk/mobile) consomment `@sigfa/ui` — fin de la duplication des tokens par app. Les polices (Fontshare) sont auto-hébergées (offline-friendly, RGPD, plein soleil).
