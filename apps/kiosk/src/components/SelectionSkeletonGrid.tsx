/**
 * AUDIT-F20 — SelectionSkeletonGrid.tsx
 * Skeleton de tuiles pour les écrans de sélection borne (services /
 * opérations / conseillers).
 *
 * L'état loading était une icône statique + texte : la borne semblait FIGÉE
 * (audit UX borne 2026-07-14, F20). Ce composant assemble le `Skeleton` du
 * design system v2 (@sigfa/ui — shimmer chaud, `prefers-reduced-motion`
 * respecté dans components.css) en GRILLE DE TUILES qui préfigure les cartes
 * réelles : même gabarit (≥ 96 px, cercle d'icône 72 px, ligne de libellé,
 * pill d'attente), mêmes tokens, zéro valeur en dur.
 *
 * Accessibilité : la grille est décorative (`aria-hidden`) ; seul le message
 * localisé (≥ 24 px, visible) est annoncé via `role="status"`.
 */
"use client";

import { Skeleton } from "@sigfa/ui";

/** 6 tuiles = 2 colonnes × 3 rangées à 1920, grille pleine sans excès. */
const DEFAULT_TILE_COUNT = 6;

export interface SelectionSkeletonGridProps {
  /** Message de chargement localisé (visible + annoncé au lecteur d'écran). */
  label: string;
  /** Nombre de tuiles squelettes (défaut : 6). */
  tileCount?: number;
  /** Identifiant de test de l'écran hôte (ex. `operations-loading`). */
  "data-testid"?: string;
}

export function SelectionSkeletonGrid({
  label,
  tileCount = DEFAULT_TILE_COUNT,
  "data-testid": testId,
}: SelectionSkeletonGridProps) {
  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      style={{
        flex: 1,
        width: "100%",
        maxWidth: "960px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      {/* Grille décorative — masquée aux lecteurs d'écran. */}
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "var(--space-6)",
        }}
      >
        {Array.from({ length: tileCount }, (_, index) => (
          <div
            key={index}
            data-testid="skeleton-tile"
            style={{
              minHeight: "96px",
              backgroundColor: "var(--surface-1)",
              borderRadius: "var(--r-lg)",
              border: "1px solid var(--hairline)",
              boxShadow: "var(--shadow-1)",
              display: "flex",
              alignItems: "center",
              padding: "var(--space-4) var(--space-6)",
              gap: "var(--space-6)",
            }}
          >
            {/* Cercle d'icône 72 px — même empreinte que les cartes réelles. */}
            <Skeleton
              width="72px"
              height="72px"
              radius="var(--r-full)"
              style={{ flexShrink: 0 }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                flex: 1,
                minWidth: 0,
              }}
            >
              {/* Ligne de libellé (28 px) puis pill d'attente (20 px). */}
              <Skeleton width="60%" height="28px" />
              <Skeleton width="38%" height="20px" radius="var(--r-full)" />
            </div>
          </div>
        ))}
      </div>

      {/* Message localisé — texte porteur de sens ≥ 24 px, contraste ≥ 7:1. */}
      <span
        style={{
          fontSize: "24px",
          color: "var(--ink-inverse)",
          textAlign: "center",
        }}
      >
        {label}
      </span>
    </div>
  );
}
