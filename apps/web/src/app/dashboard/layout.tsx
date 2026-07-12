/**
 * /dashboard layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur).
 * @module app/dashboard/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return <AuthenticatedRealtime>{children}</AuthenticatedRealtime>;
}
