# Session 2026-07-12 — RT-003 : E2E Playwright réels + statut Electron (D9)

**Story** : RT-003 (E2E Playwright, parcours complets réels + coupure réseau).
**Agent** : agent-web (rôle E2E). **Branche** : `main` (commit local, pas de push).

## Filet automatisé livré (critères 1, 2, 4) — VERT

E2E navigateur (Next hors Electron) contre l'**API + sockets RÉELS**
(Testcontainers PG16 + Redis7, `REALTIME_MODE=real`), orchestré par
`apps/web/e2e/support/global-setup.ts` :

- `apps/web/e2e/specs/journey.spec.ts` — parcours complet : borne (POST /tickets)
  → appel TV (`ticket:called` socket réel) quand l'agent appelle le suivant depuis
  son dashboard → serve + close réels → feedback public par trackingId. **VERT**.
- `apps/web/e2e/specs/network-cut.spec.ts` — coupure réseau mi-parcours
  (`context.setOffline(true)`) → bandeau offline (dégradation F4) → retour en ligne
  → resync (`sync:state` snapshot) sans perte du ticket en cours → écran final
  cohérent. **VERT**.

3 exécutions consécutives complètes vertes (stabilité vérifiée localement,
runner local). Artefacts Playwright (traces/vidéos on-failure, rapport HTML)
produits ; aucun test « vert vide ».

## Statut Electron (critère 3, D9) — best-effort / PENDING tracé

Conformément à **D9** (`docs/sessions/2026-07-12/31-critique-arbitrage-rt.md`),
le filet automatisé de la borne = **E2E navigateur**, livré vert ci-dessus. La
borne Electron réelle en CI (xvfb + libgbm) est **best-effort** et **n'est pas
un prérequis de DONE** pour cette story.

### État courant

- La borne Electron existe (`apps/kiosk/electron/main.ts`) et charge l'app Next
  kiosk. Aucun harnais Playwright-Electron réel (xvfb/libgbm headless) n'a été
  câblé dans cette story — hors périmètre du filet automatisé D9.
- **Le repli « gate humain démo tracé » n'est PAS activé** : il exige ≥2 runs CI
  Electron rouges consignés (seuil objectif, jamais auto-attestant). Ce seuil
  **n'est pas atteint** (0 run CI Electron consigné). Donc :
  - Pas de DONE auto-attestant Electron.
  - Pas d'invocation du repli démo humain.
- **Action de suivi (hors RT-003)** : si/quand la borne Electron headless est
  visée en CI, câbler xvfb + libgbm ; en cas de ≥2 runs rouges consignés,
  ouvrir le repli gate humain démo avec trace datée liée à la démo.

## Coutures / notes consignées

1. **`POST /public/tickets` non implémenté côté serveur** : la route est déclarée
   au contrat (`public.yaml`) et à la RBAC (`rbac-route-map.ts`, role NONE) mais
   **aucun handler** ne l'implémente dans l'API réelle (seuls le suivi et le
   feedback publics existent). L'UI kiosk (`ConfirmationScreen`) code contre cette
   route via le mock/contrat. Pour le parcours RÉEL, la création de ticket
   « borne » passe par `POST /api/v1/tickets` (rôle AGENT, scope agence) — vrai
   ticket WAITING + trackingId réel alimentant le pipeline socket. **Seam à
   résorber côté API dans une story ultérieure** (implémenter le handler public de
   création de ticket, hors périmètre agent-web).

2. **`join:agency` — forme de payload (couture RT-001b)** : le `SocketProvider`
   web émettait `join:agency` avec une chaîne nue alors que le serveur valide
   `{ agencyId }` (Zod). Corrigé côté web (`socket-provider.tsx`) — sans cette
   correction, aucune surface ne rejoignait la room et ne recevait `ticket:called`.

3. **Numéro d'appel absent de `call-next`** : la réponse `call-next` (callView)
   ne porte pas `number`. `useAgentFlow` le lit désormais via `GET /tickets/{id}`
   (route de contrat) pour l'affichage — fallback vide toléré (non-crash).

4. **Cycle serve→close** : `useAgentFlow.finish()` SERT (CALLED→SERVING) puis
   CLÔTURE (SERVING→DONE), conforme au cycle API-003 (close exige SERVING).
