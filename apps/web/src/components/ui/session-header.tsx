/**
 * SessionHeader — bandeau utilisateur connecté + déconnexion (WEB-002-HDR).
 *
 * Composant PARTAGÉ (réutilisable par toutes les consoles authentifiées) :
 * affiche le nom d'affichage (claim JWT vérifié côté serveur — S2 : seules des
 * données dérivées descendent, JAMAIS le token brut) et le rôle, plus un
 * bouton « Se déconnecter » sobre. La déconnexion est un <form method="post">
 * vers /api/auth/logout : purge des cookies httpOnly + redirect /login, aucun
 * JS client requis. Tokens design v2 uniquement.
 * @module components/ui/session-header
 */
import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { Role } from "@/lib/roles";

/** Props for {@link SessionHeader}. */
export interface SessionHeaderProps {
  /** Nom d'affichage de l'utilisateur (claim `displayName`), ou null. */
  name: string | null;
  /** Rôle RBAC du JWT vérifié. */
  role: Role;
  /** Active locale (FR/EN). */
  locale?: Locale;
}

/** Conteneur du bandeau — discret, hairline en pied. */
const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: "var(--space-3)",
  padding: "var(--space-2) var(--space-6)",
  background: "var(--surface-1)",
  borderBottom: "1px solid var(--hairline)",
  fontFamily: "var(--font-text)",
};

/** Bouton de déconnexion sobre (secondaire, jamais criard). */
const logoutButton: CSSProperties = {
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-md)",
  background: "var(--surface-1)",
  color: "var(--ink-soft)",
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  padding: "var(--space-1) var(--space-3)",
  cursor: "pointer",
};

/**
 * Bandeau session : identité (nom + rôle) et bouton « Se déconnecter ».
 * @param props - {@link SessionHeaderProps}.
 * @returns The header element.
 */
export function SessionHeader({ name, role, locale = "fr" }: SessionHeaderProps): ReactElement {
  return (
    <div data-testid="session-header" style={bar}>
      <span
        data-testid="session-user"
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: "var(--space-2)",
          minWidth: 0,
        }}
      >
        {name && (
          <span
            data-testid="session-user-name"
            style={{
              color: "var(--ink)",
              fontSize: "var(--text-sm)",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
        )}
        <span
          data-testid="session-user-role"
          style={{
            color: "var(--ink-faint)",
            fontSize: "var(--text-xs)",
            fontWeight: 600,
            letterSpacing: "var(--tracking-tight)",
            textTransform: "uppercase",
          }}
        >
          {t(`role.${role}`, locale)}
        </span>
      </span>
      <form method="post" action="/api/auth/logout" style={{ margin: 0 }}>
        <button type="submit" data-testid="session-logout" style={logoutButton}>
          {t("session.logout", locale)}
        </button>
      </form>
    </div>
  );
}
