/**
 * CiMap — static Côte d'Ivoire SVG map with agency markers (WEB-004).
 *
 * The country outline is an inline SVG path committed in this repository —
 * ZERO external map dependency (Leaflet/mapbox excluded, offline-friendly).
 * Each agency is positioned on its `city` via the CI_CITY_COORDINATES lookup
 * and coloured with the same badge token as the ranking (--success / --warning
 * / --danger, or --info when offline). Tokens only — no hard-coded hex.
 * @module components/network/ci-map
 */
"use client";

import type { ReactElement } from "react";
import { benchmarkBadge, cityCoordinate, type NetworkAgency } from "@/lib/network-state";

/** Props for {@link CiMap}. */
export interface CiMapProps {
  /** Agencies to plot. */
  agencies: NetworkAgency[];
  /** Configured SLA target in minutes (for the marker colour). */
  slaMinutes: number;
}

/**
 * Simplified but recognizable Côte d'Ivoire outline in a 0–100 viewBox.
 * Committed inline so the map works fully offline (no tile server, no Leaflet).
 */
const CI_OUTLINE =
  "M18 20 L48 12 L62 14 L78 22 L74 40 L82 58 L72 78 L58 90 " +
  "L40 92 L30 86 L24 70 L14 52 L12 34 Z";

/**
 * Static Côte d'Ivoire network map.
 * @param props - {@link CiMapProps}.
 * @returns The SVG map element.
 */
export function CiMap({ agencies, slaMinutes }: CiMapProps): ReactElement {
  return (
    <svg
      data-testid="ci-map-svg"
      role="img"
      aria-label="Carte du réseau — Côte d'Ivoire"
      viewBox="0 0 100 100"
      style={{ width: "100%", height: "auto", maxHeight: "420px" }}
    >
      <path
        d={CI_OUTLINE}
        fill="var(--surface-1)"
        stroke="var(--ink-soft)"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      {agencies.map((a) => {
        const point = cityCoordinate(a.city);
        if (!point) return null;
        const fill = benchmarkBadge(a.tma, slaMinutes, a.offline);
        return (
          <g key={a.agencyId}>
            <circle
              data-testid={`marker-${a.agencyId}`}
              cx={point.x}
              cy={point.y}
              r={2.6}
              fill={fill}
              stroke="var(--surface-0)"
              strokeWidth={0.6}
            >
              <title>
                {a.agencyName} — {a.city}
                {a.offline ? " (hors ligne)" : ""}
              </title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
