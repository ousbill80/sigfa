/**
 * ThemingConsole — bank identity theming editor with live preview (ADM-001b).
 *
 * A BANK_ADMIN / AGENCY_DIRECTOR picks the `--brand` colour, uploads a logo and
 * edits FR/EN welcome messages. A live preview (primary button, badge, header,
 * welcome message) re-themes in real time and displays the WCAG contrast — an
 * EXACT MIRROR of the server derivation (shared @sigfa/ui utilities via
 * lib/adm-theme). When the colour fails 4.5:1, a dedicated warning encart shows
 * the ratio (large) plus the requested and applied swatches. Save issues PATCH
 * (with X-Idempotency-Key) and shows the persisted value without a page reload.
 *
 * Theming is a SKIN, never the structure: only colour / logo / messages change.
 * No layout / font / spacing control is ever exposed. Tokens only, zero emoji,
 * @sigfa/ui primitives (EmptyState / OfflineBanner / Textarea / Heading /
 * Overline / Badge), FR/EN via the `admTheme.*` namespace, 5 states.
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
import {
  Badge,
  BankThemeProvider,
  Button,
  EmptyState,
  Field,
  Heading,
  IconAlerte,
  OfflineBanner,
  Overline,
  Skeleton,
  Textarea,
} from "@sigfa/ui";
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
        <EmptyState title={tAdmTheme("admTheme.forbidden", locale)} />
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
      <section data-testid="theming-offline">
        <OfflineBanner message={tAdmTheme("admTheme.state_offline", locale)} />
      </section>
    );
  }

  if (status === "error") {
    return (
      <section data-testid="theming-error" role="alert">
        <EmptyState
          icon={<IconAlerte size="sm" />}
          title={tAdmTheme("admTheme.state_error", locale)}
          action={
            onRetry ? (
              <Button type="button" variant="secondary" data-testid="theming-retry" onClick={onRetry}>
                {tAdmTheme("admTheme.state_retry", locale)}
              </Button>
            ) : undefined
          }
        />
      </section>
    );
  }

  if (status === "empty" || theme === null) {
    return (
      <section data-testid="theming-empty">
        <EmptyState title={tAdmTheme("admTheme.state_empty", locale)} />
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
  const colorRef = useRef<HTMLInputElement>(null);
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
  // The welcome message injected into the preview (FR first, EN fallback).
  const previewWelcome = fr.trim() || en.trim();

  return (
    <section data-testid="theming-console" aria-label={tAdmTheme("admTheme.title", locale)}>
      <Overline>{tAdmTheme("admTheme.title", locale)}</Overline>
      <Heading size="xl" style={{ margin: "var(--space-1) 0 var(--space-2)" }}>
        {tAdmTheme("admTheme.title", locale)}
      </Heading>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 var(--space-4)" }}>
        {tAdmTheme("admTheme.subtitle", locale)}
      </p>
      <p data-testid="theming-habillage-notice" className="adm-notice">
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
            {/* Native colour input is sr-only; a styled, focusable swatch
                button triggers it (keeps hover / focus, token dimensions). */}
            <button
              type="button"
              className="adm-color-trigger"
              aria-label={tAdmTheme("admTheme.brand_picker_label", locale)}
              onClick={() => colorRef.current?.click()}
              style={{ backgroundColor: pickerValue }}
            />
            <input
              ref={colorRef}
              type="color"
              data-testid="adm-brand-picker"
              aria-label={tAdmTheme("admTheme.brand_picker_label", locale)}
              className="adm-visually-hidden-input"
              value={pickerValue}
              onChange={handleColorPicker}
            />
          </div>

          <Textarea
            id="adm-welcome-fr"
            data-testid="adm-welcome-fr"
            label={tAdmTheme("admTheme.welcome_fr_label", locale)}
            hint={tAdmTheme("admTheme.welcome_hint", locale)}
            maxLength={200}
            rows={2}
            value={fr}
            onChange={(e) => {
              setFr(e.target.value);
              setSaved(false);
            }}
          />
          <Textarea
            id="adm-welcome-en"
            data-testid="adm-welcome-en"
            label={tAdmTheme("admTheme.welcome_en_label", locale)}
            maxLength={200}
            rows={2}
            value={en}
            onChange={(e) => {
              setEn(e.target.value);
              setSaved(false);
            }}
          />

          {/* ── Logo ─────────────────────────────────────────────── */}
          <div>
            <Overline>{tAdmTheme("admTheme.logo_label", locale)}</Overline>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-testid="adm-logo-preview"
                src={logoUrl}
                alt={tAdmTheme("admTheme.logo_label", locale)}
                style={{ maxHeight: "3rem", borderRadius: "var(--r-sm)" }}
              />
            ) : (
              <p data-testid="adm-logo-placeholder" style={{ color: "var(--ink-faint)", fontFamily: "var(--font-display)" }}>
                {tAdmTheme("admTheme.logo_placeholder", locale)}
              </p>
            )}
            {/* Native file input is sr-only; a styled Button triggers it. */}
            <div style={{ marginTop: "var(--space-2)" }}>
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                {tAdmTheme("admTheme.logo_upload", locale)}
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              data-testid="adm-logo-input"
              accept="image/png,image/svg+xml,image/jpeg"
              className="adm-visually-hidden-input"
              onChange={handleLogoChange}
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
          <Overline>{tAdmTheme("admTheme.preview_title", locale)}</Overline>

          <div
            data-testid="preview-header"
            style={{
              background: "var(--brand)",
              color: "var(--brand-contrast)",
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--r-md)",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              marginTop: "var(--space-2)",
            }}
          >
            {tAdmTheme("admTheme.preview_header", locale)}
          </div>

          {previewWelcome && (
            <p
              data-testid="preview-welcome"
              style={{ margin: "var(--space-3) 0 0", color: "var(--ink)", fontSize: "var(--text-sm)" }}
            >
              {previewWelcome}
            </p>
          )}

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
              {preview.passes ? (
                <>
                  <p data-testid="preview-contrast-ratio" style={{ fontVariantNumeric: "tabular-nums", margin: "var(--space-1) 0 var(--space-2)" }}>
                    {preview.ratio.toFixed(2)}:1
                  </p>
                  <Badge tone="success" dot data-testid="preview-contrast-pass">
                    {tAdmTheme("admTheme.contrast_pass", locale)}
                  </Badge>
                </>
              ) : (
                <div data-testid="preview-contrast-warning" role="status" className="adm-contrast-warn" style={{ marginTop: "var(--space-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <Badge tone="warning" dot>
                      {tAdmTheme("admTheme.contrast_warning", locale)}
                    </Badge>
                  </div>
                  <span data-testid="preview-contrast-ratio" className="adm-contrast-warn__ratio">
                    {preview.ratio.toFixed(2)}:1
                  </span>
                  <div className="adm-swatches">
                    <span className="adm-swatch">
                      <span className="adm-swatch__chip" style={{ backgroundColor: pickerValue }} />
                      {tAdmTheme("admTheme.contrast_requested", locale)}
                    </span>
                    <span className="adm-swatch">
                      <span className="adm-swatch__chip" style={{ backgroundColor: appliedBrand }} />
                      {tAdmTheme("admTheme.contrast_applied", locale)}
                    </span>
                  </div>
                  <p data-testid="preview-applied-brand" style={{ fontSize: "var(--text-sm)", color: "var(--ink-soft)", margin: 0 }}>
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
