/**
 * BankThemeProvider — effortless per-bank branding for SIGFA (multi-tenant).
 *
 * Wrap any subtree in this provider and pass the tenant's brand colour: every
 * `var(--brand*)` inside re-themes, with the WCAG-safe `--brand-contrast`
 * computed in JS (via `deriveBankTheme`). The SIGFA structure and the fixed
 * functional palette (`--forest` / `--gold` / semantics) are untouched.
 *
 * Additive by design: with NO `brandColor`, the provider injects nothing, so
 * the default SIGFA terracotta identity is preserved pixel-for-pixel.
 *
 * The optional `logoUrl` is exposed through context (`useBankLogo`) so a header
 * can render the tenant's mark without prop-drilling.
 *
 * @module theme/BankThemeProvider
 */
import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { deriveBankTheme } from "./bank-theme";

const BankLogoContext = createContext<string | undefined>(undefined);

/** The tenant logo URL from the nearest `BankThemeProvider`, if any. */
export function useBankLogo(): string | undefined {
  return useContext(BankLogoContext);
}

export interface BankThemeProviderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "color"> {
  /** Tenant brand hex. Omit to keep the default SIGFA terracotta identity. */
  brandColor?: string;
  /** Optional tenant logo URL, exposed via `useBankLogo`. */
  logoUrl?: string;
  children?: ReactNode;
}

/** CSS custom properties are valid inline-style keys, but not in the DOM type. */
type BrandVars = Record<`--${string}`, string>;

export function BankThemeProvider({
  brandColor,
  logoUrl,
  className,
  style,
  children,
  ...rest
}: BankThemeProviderProps): ReactElement {
  const brandVars = useMemo<BrandVars>((): BrandVars => {
    if (brandColor == null) return {} as BrandVars;
    const theme = deriveBankTheme(brandColor);
    return {
      "--tenant-brand": theme.brand,
      "--brand": theme.brand,
      "--brand-strong": theme.brandStrong,
      "--brand-soft": theme.brandSoft,
      "--brand-contrast": theme.brandContrast,
    };
  }, [brandColor]);

  const mergedStyle: CSSProperties = { ...style, ...(brandVars as CSSProperties) };

  return (
    <BankLogoContext.Provider value={logoUrl}>
      <div className={className} style={mergedStyle} {...rest}>
        {children}
      </div>
    </BankLogoContext.Provider>
  );
}
