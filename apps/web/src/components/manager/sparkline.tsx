/**
 * Sparkline — mini 24h line chart (Recharts) without axes (WEB-003).
 * Trait --brand, fond transparent. Fixed pixel size (deterministic in tests).
 * @module components/manager/sparkline
 */
"use client";

import type { ReactElement } from "react";
import { LineChart, Line } from "recharts";

/** Props for {@link Sparkline}. */
export interface SparklineProps {
  /** 24 hourly data points. */
  data: number[];
  /** Chart width in px. */
  width?: number;
  /** Chart height in px. */
  height?: number;
  /** Accessible label. */
  label?: string;
  /** Stroke token — one of the v2 accent tokens. */
  stroke?: "var(--brand)" | "var(--forest)" | "var(--gold)";
}

/**
 * Renders a sparkline (no axes, no grid) with a tokenised stroke.
 * @param props - {@link SparklineProps}.
 * @returns The sparkline element.
 */
export function Sparkline({
  data,
  width = 168,
  height = 44,
  label = "sparkline",
  stroke = "var(--brand)",
}: SparklineProps): ReactElement {
  const points = data.map((value, i) => ({ i, value }));
  return (
    <div
      data-testid="sparkline"
      data-points={data.length}
      aria-label={label}
      role="img"
      style={{ background: "transparent", marginTop: "var(--space-2)" }}
    >
      <LineChart width={width} height={height} data={points}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
