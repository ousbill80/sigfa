/**
 * SessionHeader — bandeau utilisateur connecté + déconnexion (WEB-002-HDR).
 *
 * Composant PARTAGÉ (réutilisable par toutes les consoles authentifiées) :
 * marque banque à gauche (logo `NEXT_PUBLIC_BANK_LOGO_URL` ou repli pastille
 * `--brand` + initiale — même convention que apps/kiosk kiosk-branding) + nom
 * de banque ; à droite le nom d'affichage (claim JWT vérifié côté serveur —
 * S2 : seules des données dérivées descendent, JAMAIS le token brut),
 * l'agence de rattachement résolue côté SERVEUR (lib/agency-label) et le
 * rôle, plus un bouton « Se déconnecter » sobre. La déconnexion est un
 * <form method="post"> vers /api/auth/logout : purge des cookies httpOnly +
 * redirect /login, aucun JS client requis. Tokens design v2 uniquement.
 * @module components/ui/session-header
 */
import type { CSSProperties, ReactElement } from "react";
import { t, type Locale } from "@/lib/i18n";
import type { Role } from "@/lib/roles";
import { bankInitial, DEFAULT_BANK_NAME } from "@/lib/bank-branding";

/** Props for {@link SessionHeader}. */
export interface SessionHeaderProps {
  /** Nom d'affichage de l'utilisateur (claim `displayName`), ou null. */
  name: string | null;
  /** Rôle RBAC du JWT vérifié. */
  role: Role;
  /** Active locale (FR/EN). */
  locale?: Locale;
  /** Nom public de la banque (repli : SIGFA). */
  bankName?: string;
  /** URL du logo banque (fond transparent) ; null → pastille `--brand`. */
  bankLogoUrl?: string | null;
  /**
   * Libellé d'agence de rattachement (« Agence Plateau », « Agence Plateau
   * +2 ») résolu côté SERVEUR ; null (0 agence — ex. bank admin — ou erreur)
   * → non affiché, le nom de banque à gauche suffit.
   */
  agencyLabel?: string | null;
}

/** Conteneur du bandeau — discret, hairline en pied. */
const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-3)",
  padding: "var(--space-2) var(--space-6)",
  background: "var(--surface-1)",
  borderBottom: "1px solid var(--hairline)",
  fontFamily: "var(--font-text)",
};

/** Hauteur de marque bornée : bandeau discret, jamais un panneau. */
const BRAND_SIZE_PX = 28;

/** Bloc marque banque (logo ou pastille + nom). */
const brandBlock: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minWidth: 0,
  flexShrink: 0,
};

/** Pastille de repli `--brand` (initiale texte, jamais d'image requise). */
const brandBadge: CSSProperties = {
  flexShrink: 0,
  width: `${BRAND_SIZE_PX}px`,
  height: `${BRAND_SIZE_PX}px`,
  borderRadius: "var(--r-md)",
  backgroundColor: "var(--brand)",
  color: "var(--brand-contrast)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--font-display)",
  fontSize: "var(--text-sm)",
  fontWeight: 700,
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
 * Bandeau session : marque banque, identité (nom + agence + rôle) et bouton
 * « Se déconnecter ».
 * @param props - {@link SessionHeaderProps}.
 * @returns The header element.
 */
export function SessionHeader({
  name,
  role,
  locale = "fr",
  bankName = DEFAULT_BANK_NAME,
  bankLogoUrl = null,
  agencyLabel = null,
}: SessionHeaderProps): ReactElement {
  return (
    <div data-testid="session-header" style={bar}>
      <span data-testid="session-bank" style={brandBlock}>
        {bankLogoUrl ? (
          /* <img> natif assumé : logo tenant (URL arbitraire) hors
             optimiseur next/image — même choix que apps/kiosk BankBrand. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid="session-bank-logo"
            src={bankLogoUrl}
            alt={bankName}
            style={{
              height: `${BRAND_SIZE_PX}px`,
              width: "auto",
              maxWidth: `${BRAND_SIZE_PX * 4}px`,
              objectFit: "contain",
              display: "block",
            }}
          />
        ) : (
          <span data-testid="session-bank-badge" aria-hidden="true" style={brandBadge}>
            {bankInitial(bankName)}
          </span>
        )}
        <span
          data-testid="session-bank-name"
          style={{
            color: "var(--ink)",
            fontSize: "var(--text-sm)",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {bankName}
        </span>
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-3)",
          minWidth: 0,
        }}
      >
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
          {agencyLabel && (
            <span
              data-testid="session-user-agency"
              style={{
                color: "var(--ink-soft)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agencyLabel}
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
      </span>
    </div>
  );
}
