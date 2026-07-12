/**
 * Root layout — injects CSS tokens.
 *
 * S2 (Boucle 2 F4) : ce layout racine couvre TOUTES les pages, y compris les
 * routes publiques (/login, /tv). Il ne lit donc plus JAMAIS le cookie
 * httpOnly `access_token` et n'injecte plus aucun provider câblé : le JWT
 * n'apparaît plus dans le payload RSC des pages publiques. Le câblage socket
 * vit dans les layouts de segment : AuthenticatedRealtime pour /agent,
 * /dashboard et /admin (token vérifié S1), app/tv/layout pour l'affichage
 * public (sans token).
 * @module app/layout
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIGFA",
  description: "Système Intégré de Gestion des Files d'Attente",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<ReactElement> {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
