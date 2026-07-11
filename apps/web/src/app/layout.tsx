/**
 * Root layout — injects CSS tokens and wraps with providers.
 * @module app/layout
 */
import type { Metadata } from "next";
import type { ReactElement } from "react";
import "./globals.css";
import { SocketProvider } from "@/lib/socket-provider";

export const metadata: Metadata = {
  title: "SIGFA",
  description: "Système Intégré de Gestion des Files d'Attente",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return (
    <html lang="fr">
      <body>
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
