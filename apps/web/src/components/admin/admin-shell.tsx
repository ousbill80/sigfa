/**
 * AdminShell — shared admin coquille (DESIGN-FIX-ADMIN).
 *
 * The three admin consoles (theming / onboarding / kiosks) diverged because
 * each rolled its own ad-hoc shell. This component is the single product frame:
 * a header (SIGFA wordmark + product title), a nav to the three consoles, a
 * `--paper` background and a standard max-width + padding content column. The
 * active route is highlighted via `aria-current="page"` (real hover / focus in
 * globals.css, never inline styles). Labels come from the `admShell.*` i18n
 * namespace (FR/EN only).
 *
 * @module components/admin/admin-shell
 */
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { ADM_NAV_ENTRIES, tAdmShell } from "@/lib/adm-shell-i18n";
import type { Locale } from "@/lib/i18n";

/** Props for {@link AdminShell}. */
export interface AdminShellProps {
  /** Active locale (FR/EN). */
  locale?: Locale;
  /** The console rendered inside the shell. */
  children: ReactNode;
}

/** Is `pathname` inside `href`'s console segment? */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Shared admin coquille — header + nav + content column.
 * @param props - {@link AdminShellProps}.
 * @returns The shell element wrapping the active console.
 */
export function AdminShell({ locale = "fr", children }: AdminShellProps): ReactElement {
  const pathname = usePathname();
  return (
    <div className="adm-shell" data-testid="admin-shell">
      <header className="adm-shell__header">
        <div className="adm-shell__brand">
          <span className="adm-shell__wordmark">{tAdmShell("admShell.product", locale)}</span>
          <span className="adm-shell__product-title">{tAdmShell("admShell.title", locale)}</span>
        </div>
        <nav className="adm-shell__nav" aria-label={tAdmShell("admShell.nav_label", locale)}>
          {ADM_NAV_ENTRIES.map((entry) => {
            const active = isActive(pathname, entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                className="adm-shell__nav-link"
                aria-current={active ? "page" : undefined}
                data-testid={`admin-nav-${entry.key.split(".").pop()}`}
              >
                {tAdmShell(entry.key, locale)}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="adm-shell__main">{children}</main>
    </div>
  );
}
