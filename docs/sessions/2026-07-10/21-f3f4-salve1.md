# Session 2026-07-11 — F3‖F4 salve 1 intégrée

DONE : CONTRACT-012 · API-001 (auth, 24 tests, Schemathesis 156 cas) · KIOSK-001 (shell Electron/Next/i18n, 12 tests) · WEB-001 (shell auth/RBAC/theming, 66 tests) · MOB-001+002 (Metro plan A, 103 tests).
Corrections d intégration : langues web AR/MG→Dioula/Baoulé · export createSigfaClient · imports .js vs bundler Next (+ build ajouté au gate kiosk) · override turbo typecheck kiosk par-package · conflit @types/react 18/19 inter-pistes (fix jest setupFiles, cause : @redocly→react-native fantôme).
Gate 47/47 vert. DESIGN-GATE soumis au PO : docs/design-gates/{kiosk-wireframes.md, web-tv-wireframes.md}.
En arrière-plan : API-002 (main) + MOB-003..005 (worktree).
