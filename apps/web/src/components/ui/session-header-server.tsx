/**
 * SessionHeaderServer — assemblage SERVEUR du bandeau session (WEB-002-HDR).
 *
 * Server component partagé par TOUS les segments authentifiés (agent,
 * dashboard manager/COMEX, admin) : lit le cookie httpOnly VÉRIFIÉ
 * (lib/server-session), résout le nom de l'agence de rattachement via
 * `GET /agencies/{id}` (Bearer injecté ICI — S2 : le token brut ne descend
 * JAMAIS dans l'arbre) et la marque banque d'env (lib/bank-branding), puis
 * rend le SessionHeader présentationnel. Sans session vérifiée (mode mock
 * RT-001b), le bandeau est simplement absent.
 * @module components/ui/session-header-server
 */
import type { ReactElement } from "react";
import type { Locale } from "@/lib/i18n";
import { readVerifiedSession } from "@/lib/server-session";
import { resolveAgencyLabel } from "@/lib/agency-label";
import { bankLogoUrl, bankName } from "@/lib/bank-branding";
import { SessionHeader } from "@/components/ui/session-header";

/** Props for {@link SessionHeaderServer}. */
export interface SessionHeaderServerProps {
  /** Active locale (FR/EN). */
  locale?: Locale;
}

/**
 * Bandeau session résolu côté serveur, ou null sans session vérifiée.
 * @param props - {@link SessionHeaderServerProps}.
 * @returns The header element, or null.
 */
export async function SessionHeaderServer({
  locale = "fr",
}: SessionHeaderServerProps): Promise<ReactElement | null> {
  const session = await readVerifiedSession();
  if (!session) return null;
  const agencyLabel = await resolveAgencyLabel(session);
  return (
    <SessionHeader
      name={session.claims.displayName}
      role={session.claims.role}
      locale={locale}
      bankName={bankName()}
      bankLogoUrl={bankLogoUrl()}
      agencyLabel={agencyLabel}
    />
  );
}
