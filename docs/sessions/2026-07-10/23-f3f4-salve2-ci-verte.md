# Session 2026-07-11/12 — F3‖F4 salve 2 intégrée · CI VERTE 6 jobs

DONE : API-002 (tenant+RBAC 80 routes, withPlatform) · API-003 (cycle ticket cœur, 79 tests, Schemathesis 582 cas) · KIOSK-002..005 (parcours borne, screenshots réels ×4 langues) · TV-001/002 · WEB-002/003 · MOB-003..005. Piste mobile COMPLÈTE (MOB-001..005).
La CI a mordu longuement (cascade « env CI ≠ poste », leçon promue à 4 occurrences) : tests runtime Prism/Docker isolés du gate couverture (job Contract Runtime) · assertion latence 500ms déléguée à RT-002 · baseline couverture recalibrée 97.98→90.7 (dilution légitime par 4 apps frontend ≥85%/workspace) · flaky OTP mobile réparé (T8) · 2 co-signatures agents purgées (force-push encadré).
État : F0/F1/F2 DONE · F3 : API-001/002/003 DONE, reste 004-011 · F4 : mobile DONE, kiosk 001-005 DONE (reste 006-009), web/TV 001-003 DONE (reste WEB-004-006).
