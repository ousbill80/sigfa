/**
 * MswProvider — démarrage du worker MSW navigateur en DÉVELOPPEMENT UNIQUEMENT.
 *
 * Objectif : rendre la borne cliquable et peuplée en démo locale (`next dev`)
 * SANS backend. Le worker intercepte les fetchs publics (services, opérations,
 * ticket) via les handlers de `src/mocks/handlers.ts`.
 *
 * GARDE D'ENVIRONNEMENT STRICTE — le worker n'est démarré que si :
 *   - `process.env.NODE_ENV === 'development'`, ET
 *   - le flag `NEXT_PUBLIC_ENABLE_MSW === '1'`.
 * En production (static export `output: export` / Electron), aucune de ces
 * conditions n'est vraie : l'import du worker et son démarrage sont ignorés,
 * zéro octet MSW n'affecte le parcours réel.
 *
 * Lancement de la démo :
 *   NEXT_PUBLIC_ENABLE_MSW=1 pnpm --filter @sigfa/kiosk dev
 * puis ouvrir http://localhost:3002/fr
 */
"use client";

import { useEffect, useState } from "react";

/** Garde stricte : dev + flag explicite. Évaluée à froid (tree-shakeable). */
const MSW_ENABLED =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_MSW === "1";

export function MswProvider({ children }: { children: React.ReactNode }) {
  // En prod, MSW_ENABLED est `false` : on rend directement les enfants sans
  // jamais attendre ni importer le worker (l'effet ci-dessous est inerte).
  const [ready, setReady] = useState(!MSW_ENABLED);

  useEffect(() => {
    // Garde au niveau du bloc `import()` : en production, `NODE_ENV` est inliné
    // à "production" par Next, ce `if` se replie donc à `false` au build et
    // webpack ÉLIMINE l'import dynamique — aucun chunk MSW dans le static export.
    if (process.env.NODE_ENV !== "development") return;
    if (!MSW_ENABLED) return;

    let cancelled = false;
    // Import dynamique : le worker MSW n'est chargé qu'à l'exécution en dev.
    // Le chunk émis par le bundler n'est JAMAIS référencé ni fetché en prod
    // (cette branche est morte quand NODE_ENV==="production").
    void import("@/mocks/browser").then(async ({ worker }) => {
      await worker.start({
        // Ne pas polluer la console pour les requêtes non mockées (assets Next).
        onUnhandledRequest: "bypass",
        serviceWorker: { url: "/mockServiceWorker.js" },
      });
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Tant que le worker n'est pas prêt (dev only), on évite un premier fetch qui
  // partirait avant l'interception : on ne rend rien de bloquant, juste un
  // placeholder neutre le temps du démarrage (quelques ms).
  if (!ready) return null;

  return <>{children}</>;
}
