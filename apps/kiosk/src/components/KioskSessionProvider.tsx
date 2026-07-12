/**
 * Boucle 2 F4 — S5 : câblage RUNTIME de la session borne (KIOSK-001).
 *
 * Monté dans le layout, ce provider :
 *  - provisionne la session borne au DÉMARRAGE (POST /kiosk/session exécuté
 *    par le processus principal Electron — le secret ne quitte jamais le main
 *    process, cf. `electron/main.ts` + `electron/preload.ts`) ;
 *  - RE-CRÉE la session à expiration (12 h, non renouvelable) ;
 *  - en échec : bannière NON bloquante (états dégradés KIOSK-007) + retry
 *    silencieux en arrière-plan — le parcours client n'est jamais bloqué.
 *
 * Sans pont Electron (navigateur nu / mode mock Prism), aucun provisionnement
 * n'est possible côté client sans exposer le secret : le provider reste
 * silencieux (couture consignée au rapport de boucle).
 */
"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ensureKioskSession,
  registerKioskSessionProvisioner,
  resolveKioskSessionProvisioner,
  type KioskSessionProvisioner,
} from "@/lib/kiosk-session-store";

/** Délai par défaut entre deux tentatives silencieuses de reconnexion. */
const DEFAULT_RETRY_DELAY_MS = 30_000;

interface KioskSessionProviderProps {
  children: React.ReactNode;
  /**
   * Provisionneur de session. `undefined` = résolution runtime (pont Electron
   * si présent) ; `null` = aucun canal (navigateur nu). Injectable en test.
   */
  provisioner?: KioskSessionProvisioner | null;
  /** Délai de retry silencieux en échec (défaut 30 s). */
  retryDelayMs?: number;
}

export function KioskSessionProvider({
  children,
  provisioner,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: KioskSessionProviderProps) {
  const t = useTranslations("session");
  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    const active =
      provisioner !== undefined ? provisioner : resolveKioskSessionProvisioner();
    registerKioskSessionProvisioner(active);

    // Pas de canal de provisionnement (navigateur/mock) : silencieux, pas de
    // bannière — il n'y a rien à reconnecter côté client.
    if (!active) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (): Promise<void> => {
      const session = await ensureKioskSession();
      if (cancelled) return;

      if (session) {
        setIsDegraded(false);
        // Session de 12 h NON renouvelable → re-création programmée à l'échéance.
        const refreshInMs = Math.max(
          session.createdAt + session.expiresIn * 1000 - Date.now(),
          0
        );
        timer = setTimeout(() => {
          void attempt();
        }, refreshInMs);
      } else {
        // Échec : borne dégradée non bloquante + retry silencieux.
        setIsDegraded(true);
        timer = setTimeout(() => {
          void attempt();
        }, retryDelayMs);
      }
    };

    void attempt();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [provisioner, retryDelayMs]);

  return (
    <>
      {/* Bannière dégradée NON bloquante — jamais de modale, le parcours continue. */}
      {isDegraded && (
        <div
          data-testid="session-degraded-banner"
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "1rem 1.5rem",
            backgroundColor: "var(--surface-1)",
            color: "var(--ink-inverse)",
            fontSize: "24px",
          }}
        >
          <span aria-hidden="true" style={{ color: "var(--info)", fontSize: "24px" }}>
            ⟳
          </span>
          {t("reconnecting")}
        </div>
      )}
      {children}
    </>
  );
}
