## KIOSK-001 : Shell Electron + mode kiosque fullscreen + i18n 4 langues + tokens design

**Module** : F4 — Kiosque · **Agent** : agent-kiosk · **Dépend de** : CONTRACT-009 · **Statut** : TODO

**Révision** : v2 — arbitrage 19

### Exigences (EARS)

- UBIQUITAIRE : l'application tourne dans Electron 28+ en mode `kiosk: true` fullscreen (Windows/Linux tablette agence) ; aucun accès au bureau OS, aucune barre de titre, aucun menu système.
- UBIQUITAIRE : toutes les valeurs de couleur, typographie, rayon et espacement sont exclusivement des tokens CSS (`--surface-kiosk: #0E1420`, `--ink-inverse: #F5F7FA`, `--brand`, `--success: #12B76A`, `--warning: #F79009`, `--danger: #F04438`, `--info: #2E90FA`) — zéro valeur en dur dans le code.
- UBIQUITAIRE : le client HTTP est `@sigfa/contracts` exclusivement ; aucun `fetch()` direct vers une URL hors contrat.
- UBIQUITAIRE : la variable d'environnement `MOCK_API_URL` pointe vers le mock Prism ; le code ne hard-code aucune URL.
- UBIQUITAIRE : next-intl 4 langues (FR / Dioula / Baoulé / EN) ; aucun texte en dur dans les composants.
- QUAND l'application démarre, elle doit tenter POST `/kiosk/session` (kioskId + kioskSecret + agencyId depuis `.env`) et stocker le JWT scope agency TTL 43 200 s.
- SI la session borne est expirée ou absente, ALORS l'application doit afficher un écran d'erreur non bloquant pour le client et tenter une reconnexion silencieuse en arrière-plan.
- LÀ OÙ `prefers-reduced-motion` est actif, toutes les animations doivent être supprimées (pas seulement réduites).

### Critères d'acceptation

- [ ] `KIOSK-001: logique shell couverte par Testing Library + snapshot Next.js hors Electron (CI) — run Electron réel = gate humain démo (RT-003), pas critère CI F4`
- [ ] `KIOSK-001: MSW 2.x configuré browser+node — interception mock Prism fonctionnelle en tests`
- [ ] `KIOSK-001: aucune valeur de couleur ou taille en dur dans le diff (grep -E '#[0-9a-fA-F]{3,6}|px(?!-)' hors tokens)`
- [ ] `KIOSK-001: POST /kiosk/session appellé au boot — mock Prism répond 201 expiresIn=43200`
- [ ] `KIOSK-001: session expirée → écran erreur humain + retry silencieux (test d'horloge Vitest)`
- [ ] `KIOSK-001: next-intl charge les 4 locales sans erreur de clé manquante`
- [ ] `KIOSK-001: aucun fetch() hors @sigfa/contracts (grep fetch dans apps/kiosk/src — zéro occurrence)`
- [ ] `KIOSK-001: prefers-reduced-motion → zéro animation dans le DOM (axe-core + media-query mock)`

### Outillage de test (inscrit ici, réutilisé par toutes les stories KIOSK)

- **MSW 2.x** configuré browser + node.
- **Playwright `toHaveScreenshot`** (maxDiffPixelRatio 0.002) ; snapshots dans `apps/kiosk/e2e/__snapshots__/{story}/{lang}.png` (commités).
- **Pattern Electron headless CI** : REPLI ADOPTÉ — la logique est couverte par Testing Library + snapshots Next.js hors Electron ; le run Electron réel (xvfb + libgbm documentés dans la story) est un **gate humain démo**, pas un critère CI F4. Le run Electron E2E complet est tracé en RT-003.

### Hors scope de cette story

Écrans métier (KIOSK-002+), offline Dexie (KIOSK-006), accessibilité vocale (KIOSK-008).
