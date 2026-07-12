/**
 * Root layout — injects CSS tokens and wraps with providers.
 *
 * RT-003 (couture RT-001b) : câblage du token réel. Ce layout est un SERVER
 * component ; il lit le cookie httpOnly `access_token` (invisible au JS client),
 * en dérive `agencyId` (scope tenant du JWT) et le `mode` temps réel, puis
 * injecte token/url/agencyId/mode dans le `SocketProvider` (client). Aucun fetch
 * hors contrat (C1) : la seule source est le cookie déjà posé par /api/auth/login.
 *
 * @module app/layout
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { cookies } from "next/headers";
import "./globals.css";
import { SocketProvider, type RealtimeMode } from "@/lib/socket-provider";
import { firstAgencyIdFromToken } from "@/lib/socket-wiring";

export const metadata: Metadata = {
  title: "SIGFA",
  description: "Système Intégré de Gestion des Files d'Attente",
};

/** Mode temps réel serveur (dérivé de l'env, défaut off). */
function resolveMode(): RealtimeMode {
  return process.env.NEXT_PUBLIC_REALTIME_MODE === "real" ? "real" : "off";
}

/** URL de l'API socket (mock canonique :4010 par défaut). */
function resolveUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4010";
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  const mode = resolveMode();
  // Le socket parle au serveur HTTP+WS (racine), pas au préfixe /api/v1 REST.
  // NEXT_PUBLIC_API_URL peut inclure /api/v1 pour les clients REST ; on rebase
  // le socket sur l'origine.
  const url = socketOrigin(resolveUrl());

  // Lecture du cookie httpOnly côté serveur uniquement.
  let token: string | undefined;
  let agencyId: string | undefined;
  if (mode === "real") {
    const store = await cookies();
    token = store.get("access_token")?.value;
    agencyId = token ? (firstAgencyIdFromToken(token) ?? undefined) : undefined;
  }

  return (
    <html lang="fr">
      <body>
        <SocketProvider mode={mode} url={url} token={token} agencyId={agencyId}>
          {children}
        </SocketProvider>
      </body>
    </html>
  );
}

/** Rebase une URL REST (potentiellement suffixée /api/v1) sur son origine socket. */
function socketOrigin(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return apiUrl;
  }
}
