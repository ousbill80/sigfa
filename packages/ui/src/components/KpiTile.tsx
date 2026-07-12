/**
 * KpiTile — SIGFA v2 dashboard tile. Tabular `--text-4xl` value + discreet
 * label + coloured delta. All text comes from props (i18n-agnostic).
 *
 * @module components/KpiTile
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

export type KpiTrend = "up" | "down" | "flat";

export interface KpiTileProps extends HTMLAttributes<HTMLDivElement> {
  /** Discreet label above the value. */
  label: string;
  /** The headline value (already formatted for the current locale). */
  value: string;
  /** Optional delta text (e.g. "+12% vs J-7"). */
  delta?: string;
  /** Delta direction — drives colour + arrow semantics. */
  trend?: KpiTrend;
  /** Optional slot (e.g. a sparkline) rendered under the value. */
  children?: ReactNode;
}

const TREND_GLYPH: Record<KpiTrend, string> = {
  up: "↗", // ↗
  down: "↘", // ↘
  flat: "→", // →
};

export function KpiTile({
  label,
  value,
  delta,
  trend = "flat",
  className,
  children,
  ...rest
}: KpiTileProps): ReactNode {
  return (
    <div className={clsx("sig-kpi", className)} {...rest}>
      <span className="sig-kpi__label">{label}</span>
      <span className="sig-kpi__value">{value}</span>
      {delta != null && (
        <span className={clsx("sig-kpi__delta", `sig-kpi__delta--${trend}`)}>
          <span aria-hidden="true">{TREND_GLYPH[trend]}</span>
          {delta}
        </span>
      )}
      {children}
    </div>
  );
}
