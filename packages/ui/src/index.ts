/**
 * @sigfa/ui — SIGFA Design System v2 « Sérénité Premium ».
 *
 * Public entry: token values, the WCAG contrast utilities and every canonical
 * component. Import the token / font stylesheets separately:
 *   import "@sigfa/ui/tokens.css";
 *   import "@sigfa/ui/fonts.css";
 *
 * @module index
 */
export const UI_VERSION = "2.0.0";

// Tokens (JS mirror of tokens.css) — for tests + future mobile RN theme.
export * from "./tokens";

// Utilities
export * from "./lib/contrast";

// Bank theming (multi-tenant branding)
export { deriveBankTheme, SIGFA_DEFAULT_BRAND } from "./theme/bank-theme";
export type { BankTheme } from "./theme/bank-theme";
export { BankThemeProvider, useBankLogo } from "./theme/BankThemeProvider";
export type { BankThemeProviderProps } from "./theme/BankThemeProvider";

// Components
export { Button } from "./components/Button";
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
} from "./components/Button";
export { Card } from "./components/Card";
export type { CardProps } from "./components/Card";
export { Field } from "./components/Field";
export type { FieldProps } from "./components/Field";
export { Textarea } from "./components/Textarea";
export type { TextareaProps } from "./components/Textarea";
export { Select } from "./components/Select";
export type { SelectProps, SelectOption } from "./components/Select";
export { SegmentedControl } from "./components/SegmentedControl";
export type {
  SegmentedControlProps,
  SegmentedOption,
} from "./components/SegmentedControl";
export { Spinner } from "./components/Spinner";
export type { SpinnerProps, SpinnerSize } from "./components/Spinner";
export {
  Heading,
  PageTitle,
  SectionTitle,
  Overline,
} from "./components/Typography";
export type {
  HeadingProps,
  HeadingSize,
  SectionTitleProps,
  SectionTitleSize,
  OverlineProps,
} from "./components/Typography";
export { Badge } from "./components/Badge";
export type { BadgeProps, BadgeTone } from "./components/Badge";
export { KpiTile } from "./components/KpiTile";
export type { KpiTileProps, KpiTrend } from "./components/KpiTile";
export { TicketMoment } from "./components/TicketMoment";
export type { TicketMomentProps } from "./components/TicketMoment";
export { OfflineBanner } from "./components/OfflineBanner";
export type { OfflineBannerProps } from "./components/OfflineBanner";
export { Skeleton } from "./components/Skeleton";
export type { SkeletonProps } from "./components/Skeleton";
export { EmptyState } from "./components/EmptyState";
export type { EmptyStateProps } from "./components/EmptyState";
export { Dialog } from "./components/Dialog";
export type { DialogProps } from "./components/Dialog";
export { Stepper } from "./components/Stepper";
export type { StepperProps } from "./components/Stepper";
