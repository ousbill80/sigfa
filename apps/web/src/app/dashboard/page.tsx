/**
 * /dashboard — hub : redirection SERVEUR vers le dashboard du rôle (WEB-001).
 *
 * Ce segment générique ne porte AUCUNE donnée propre : c'est la cible par
 * défaut du login (`?next=`). Avant ce fix il rendait un titre statique — le
 * « /dashboard vide » remonté par le PO. Il résout désormais le contexte
 * tenant côté serveur (claims du JWT vérifié en real, fixtures en mock —
 * lib/server-session) et redirige vers la surface qui porte les données du
 * rôle (lib/roles#getDefaultDashboard).
 * @module app/dashboard/page
 */
import { redirect } from "next/navigation";
import { resolveTenantContext } from "@/lib/server-session";
import { getDefaultDashboard } from "@/lib/roles";

export default async function DashboardPage(): Promise<never> {
  const ctx = await resolveTenantContext();
  redirect(getDefaultDashboard(ctx.role));
}
