/**
 * ThemingConsole — bank identity theming editor with live preview (ADM-001b).
 *
 * A BANK_ADMIN / AGENCY_DIRECTOR picks the `--brand` colour, uploads a logo and
 * edits FR/EN welcome messages. A live preview (primary button, badge, header)
 * re-themes in real time and displays the WCAG contrast — an EXACT MIRROR of the
 * server derivation (shared @sigfa/ui utilities via lib/adm-theme). When the
 * colour fails 4.5:1, an inline warning shows the corrected value that will be
 * applied. Save issues PATCH (with X-Idempotency-Key) and shows the persisted
 * value without a page reload.
 *
 * Theming is a SKIN, never the structure: only colour / logo / messages change.
 * No layout / font / spacing control is ever exposed. Tokens only, zero emoji,
 * @sigfa/ui components, FR/EN via the `admTheme.*` namespace, 5 states.
 *
 * @module components/admin/theming-console
 */
"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactElement,
} from "react";
import { Badge, BankThemeProvider, Button, Field, Skeleton } from "@sigfa/ui";
import { canConfigureTheming, previewBrand } from "@/lib/adm-theme";
import { tAdmTheme } from "@/lib/adm-theme-i18n";
import type { LoadedTheme, ThemeMutationResult, ThemeStatus } from "@/lib/use-adm-theme";
import type { WelcomeMessages } from "@/lib/adm-theme";
import type { Role } from "@/lib/roles";
import type { Locale } from "@/lib/i18n";

/** Props for {@link ThemingConsole}. */
export interface ThemingConsoleProps {
  /** Viewer role — gates the whole section (BANK_ADMIN / AGENCY_DIRECTOR+). */
  role: Role;
  /** Current screen status (loading / ready / empty / error / offline). */
  status: ThemeStatus;
  /** Loaded theme (null until ready). */
  theme: LoadedTheme | null;
  /** Persist brand + welcome messages (PATCH). */
  onSave: (draft: { brand: string; welcomeMessages: WelcomeMessages }) => Promise<ThemeMutationResult>;
  /** Upload a logo (POST multipart). */
  onUploadLogo: (file: File) => Promise<ThemeMutationResult>;
  /** Retry a failed load. */
  onRetry?: () => void;
  /** Active locale. */
  locale?: Locale;
}

const DEFAULT_BRAND = "#c25a16";

const overline: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-2)",
};

const noticeStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  background: "var(--surface-2)",
  borderRadius: "var(--r-md)",
  padding: "var(--space-3) var(--space-4)",
  margin: "0 0 var(--space-6)",
};

/**
 * Bank identity theming console.
 * @param props - {@link ThemingConsoleProps}.
 * @returns The console element (or a guarded/state element).
 */
export function ThemingConsole(props: ThemingConsoleProps): ReactElement {
  const { role, status, theme, onSave, onUploadLogo, onRetry, locale = "fr" } = props;

  // RBAC: theming is BANK_ADMIN+ incl. AGENCY_DIRECTOR (ADM-001b). AGENT /
  // MANAGER / AUDITOR → forbidden.
  if (!canConfigureTheming(role)) {
    return (
      <section data-testid="theming-forbidden" role="alert" aria-label={tAdmTheme("admTheme.forbidden", locale)}>
        <p style={{ color: "var(--ink-soft)" }}>{tAdmTheme("admTheme.forbidden", locale)}</p>
      </section>
    );
  }

  if (status === "loading") {
    return (
      <section data-testid="theming-loading" aria-busy="true">
        <span className="sig-visually-hidden">{tAdmTheme("admTheme.state_loading", locale)}</span>
        <Skeleton height="1.5rem" width="14rem" />
        <div style={{ marginTop: "var(--space-4)" }}>
          <Skeleton height="10rem" />
        </div>
      </section>
    );
  }

  if (status === "offline") {
    return (
      <section data-testid="theming-offline" role="status">
        <p style={{ color: "var(--ink-soft)" }}>{tAdmTheme("admTheme.state_offline", locale)}</p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section data-testid="theming-error" role="alert">
        <p style={{ color: "var(--ink-soft)" }}>{tAdmTheme("admTheme.state_error", locale)}</p>
        {onRetry && (
          <Button type="button" variant="secondary" data-testid="theming-retry" onClick={onRetry}>
            {tAdmTheme("admTheme.save", locale)}
          </Button>
        )}
      </section>
    );
  }

  if (status === "empty" || theme === null) {
    return (
      <section data-testid="theming-empty" role="status">
        <p style={{ color: "var(--ink-soft)" }}>{tAdmTheme("admTheme.state_empty", locale)}</p>
      </section>
    );
  }

  return (
    <ThemingEditor
      key={theme.brand}
      initial={theme}
      onSave={onSave}
      onUploadLogo={onUploadLogo}
      locale={locale}
    />
  );
}

/** Inner editor — mounted only once a theme is loaded (`ready`). */
function ThemingEditor(props: {
  initial: LoadedTheme;
  onSave: ThemingConsoleProps["onSave"];
  onUploadLogo: ThemingConsoleProps["onUploadLogo"];
  locale: Locale;
}): ReactElement {
  const { initial, onSave, onUploadLogo, locale } = props;
  const [brand, setBrand] = useState(initial.brand || DEFAULT_BRAND);
  const [fr, setFr] = useState(initial.welcomeMessages.fr);
  const [en, setEn] = useState(initial.welcomeMessages.en ?? "");
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();
  const [logoError, setLogoError] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => previewBrand(brand), [brand]);

  const handleColorPicker = (e: ChangeEvent<HTMLInputElement>): void => {
    setBrand(e.target.value);
    setSaved(false);
  };

  const handleHex = (e: ChangeEvent<HTMLInputElement>): void => {
    setBrand(e.target.value);
    setSaved(false);
  };

  const handleSave = (): void => {
    setServerError(undefined);
    setSaved(false);
    void onSave({ brand, welcomeMessages: { fr, ...(en.trim() ? { en } : {}) } }).then((r) => {
      if (r.ok) {
        setSaved(true);
        if (r.theme) setBrand(r.theme.brand);
      } else {
        setServerError(r.message);
      }
    });
  };

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(undefined);
    void onUploadLogo(file).then((r) => {
      if (r.ok && r.theme?.logoUrl !== undefined) setLogoUrl(r.theme.logoUrl);
      else if (!r.ok) setLogoError(r.message);
    });
  };

  // The valid picker colour (native <input type=color> needs a #RRGGBB value).
  const pickerValue = preview.valid ? preview.tokens!.brand : DEFAULT_BRAND;
  // Preview surface uses the applied (possibly corrected) colour.
  const appliedBrand = preview.valid ? preview.appliedBrand : DEFAULT_BRAND;

  return (
    <section data-testid="theming-console" aria-label={tAdmTheme("admTheme.title", locale)}>
      <p style={overline}>{tAdmTheme("admTheme.title", locale)}</p>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 var(--space-4)" }}>
        {tAdmTheme("admTheme.subtitle", locale)}
      </p>
      <p data-testid="theming-habillage-notice" style={noticeStyle}>
        {tAdmTheme("admTheme.habillage_notice", locale)}
      </p>

      <div style={{ display: "grid", gap: "var(--space-8)", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 22rem)" }}>
        {/* ── Editor column ─────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Field
                id="adm-brand-hex"
                data-testid="adm-brand-hex"
                label={tAdmTheme("admTheme.brand_label", locale)}
                hint={tAdmTheme("admTheme.brand_hint", locale)}
                value={brand}
                onChange={handleHex}
                aria-invalid={!preview.valid || undefined}
              />
            </div>
            <input
              type="color"
              data-testid="adm-brand-picker"
              aria-label={tAdmTheme("admTheme.brand_picker_label", locale)}
              value={pickerValue}
              onChange={handleColorPicker}
              style={{
                width: "44px",
                height: "44px",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--r-md)",
                background: "none",
                padding: 0,
                flexShrink: 0,
              }}
            />
          </div>

          <Field
            id="adm-welcome-fr"
            data-testid="adm-welcome-fr"
            label={tAdmTheme("admTheme.welcome_fr_label", locale)}
            hint={tAdmTheme("admTheme.welcome_hint", locale)}
            maxLength={200}
            value={fr}
            onChange={(e) => {
              setFr(e.target.value);
              setSaved(false);
            }}
          />
          <Field
            id="adm-welcome-en"
            data-testid="adm-welcome-en"
            label={tAdmTheme("admTheme.welcome_en_label", locale)}
            maxLength={200}
            value={en}
            onChange={(e) => {
              setEn(e.target.value);
              setSaved(false);
            }}
          />

          {/* ── Logo ─────────────────────────────────────────────── */}
          <div>
            <p style={overline}>{tAdmTheme("admTheme.logo_label", locale)}</p>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="adm-logo-preview"
                src={logoUrl}
                alt={tAdmTheme("admTheme.logo_label", locale)}
                style={{ maxHeight: "48px", borderRadius: "var(--r-sm)" }}
              />
            ) : (
              <p data-testid="adm-logo-placeholder" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-display)" }}>
                {tAdmTheme("admTheme.logo_placeholder", locale)}
              </p>
            )}
            <input
              ref={fileRef}
              type="file"
              data-testid="adm-logo-input"
              accept="image/png,image/svg+xml,image/jpeg"
              onChange={handleLogoChange}
              style={{ marginTop: "var(--space-2)" }}
            />
            <p style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)", marginTop: "var(--space-1)" }}>
              {tAdmTheme("admTheme.logo_hint", locale)}
            </p>
            {logoError && (
              <p data-testid="adm-logo-error" role="alert" style={{ color: "var(--danger)", fontSize: "var(--text-sm)" }}>
                {logoError}
              </p>
            )}
          </div>

          <div>
            <Button type="button" variant="primary" data-testid="adm-theme-save" onClick={handleSave}>
              {tAdmTheme("admTheme.save", locale)}
            </Button>
            {saved && (
              <span data-testid="adm-theme-saved" role="status" style={{ marginLeft: "var(--space-3)", color: "var(--ink-soft)" }}>
                {tAdmTheme("admTheme.saved", locale)}
              </span>
            )}
            {serverError && (
              <p data-testid="adm-theme-server-error" role="alert" style={{ color: "var(--danger)", fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
                {serverError}
              </p>
            )}
          </div>
        </div>

        {/* ── Live preview column (server mirror) ───────────────────── */}
        <BankThemeProvider
          brandColor={appliedBrand}
          data-testid="theming-preview"
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-lg)",
            padding: "var(--space-5)",
            background: "var(--surface-1)",
          }}
        >
          <p style={overline}>{tAdmTheme("admTheme.preview_title", locale)}</p>

          <div
            data-testid="preview-header"
            style={{
              background: "var(--brand)",
              color: "var(--brand-contrast)",
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--r-md)",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
            }}
          >
            {tAdmTheme("admTheme.preview_header", locale)}
          </div>

          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", margin: "var(--space-4) 0" }}>
            <Button type="button" variant="primary" data-testid="preview-button">
              {tAdmTheme("admTheme.preview_button", locale)}
            </Button>
            <Badge tone="brand" data-testid="preview-badge">
              {tAdmTheme("admTheme.preview_badge", locale)}
            </Badge>
          </div>

          {/* ── Contrast (mirror of server WCAG check) ─────────────── */}
          {preview.valid && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--ink-faint)", margin: 0 }}>
                {tAdmTheme("admTheme.contrast_label", locale)}
              </p>
              <p data-testid="preview-contrast-ratio" style={{ fontVariantNumeric: "tabular-nums", margin: "var(--space-1) 0 0" }}>
                {preview.ratio.toFixed(2)}:1
              </p>
              {preview.passes ? (
                <Badge tone="success" dot data-testid="preview-contrast-pass">
                  {tAdmTheme("admTheme.contrast_pass", locale)}
                </Badge>
              ) : (
                <div data-testid="preview-contrast-warning" role="status" style={{ marginTop: "var(--space-2)" }}>
                  <Badge tone="warning" dot>
                    {tAdmTheme("admTheme.contrast_warning", locale)}
                  </Badge>
                  <p data-testid="preview-applied-brand" style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", marginTop: "var(--space-1)" }}>
                    {tAdmTheme("admTheme.applied_value", locale)} : {preview.appliedBrand}
                  </p>
                </div>
              )}
            </div>
          )}
        </BankThemeProvider>
      </div>
    </section>
  );
}
