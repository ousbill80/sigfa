/**
 * /admin layout — segment authentifié (S2) : socket câblé via
 * AuthenticatedRealtime (cookie httpOnly lu et VÉRIFIÉ côté serveur).
 * @module app/admin/layout
 */
import type { ReactElement } from "react";
import { AuthenticatedRealtime } from "@/lib/authenticated-realtime";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): ReactElement {
  return <AuthenticatedRealtime>{children}</AuthenticatedRealtime>;
}
