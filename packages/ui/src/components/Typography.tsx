/**
 * Typography primitives — SIGFA v2. They LOCK the type scale so apps stop
 * hand-rolling divergent inline titles. Every heading is Clash Display
 * (`--font-display`), `--ink`, weight 600, leading-tight; kickers use
 * `--font-text`, `--ink-faint`, `--text-xs` with wide tracking.
 *
 *  - `Heading` / `PageTitle` : the page h1 (`--text-2xl` / `--text-3xl`).
 *  - `SectionTitle`          : an h2 (`--text-lg` / `--text-xl`).
 *  - `Overline`              : the small uppercase kicker above a title.
 *
 * All text comes from `children` (i18n-agnostic).
 *
 * @module components/Typography
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { clsx } from "clsx";

/** Heading visual size (independent of the semantic tag). */
export type HeadingSize = "xl" | "2xl" | "3xl";
/** Section-title visual size. */
export type SectionTitleSize = "lg" | "xl";

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Type scale — drives the font-size token. Defaults to `2xl`. */
  size?: HeadingSize;
  children?: ReactNode;
}

/**
 * Page-level heading (`<h1>`). Use once per screen. `PageTitle` is the same
 * primitive under a product-friendly name.
 */
export function Heading({
  size = "2xl",
  className,
  children,
  ...rest
}: HeadingProps): ReactNode {
  return (
    <h1
      data-testid="heading"
      className={clsx("sig-heading", `sig-heading--${size}`, className)}
      {...rest}
    >
      {children}
    </h1>
  );
}

/** Product alias for {@link Heading} — the h1 of a page. */
export function PageTitle(props: HeadingProps): ReactNode {
  return <Heading data-testid="page-title" {...props} />;
}

export interface SectionTitleProps
  extends HTMLAttributes<HTMLHeadingElement> {
  /** Type scale — `lg` (default) or `xl`. */
  size?: SectionTitleSize;
  children?: ReactNode;
}

/** Section heading (`<h2>`). Groups content under a page. */
export function SectionTitle({
  size = "lg",
  className,
  children,
  ...rest
}: SectionTitleProps): ReactNode {
  return (
    <h2
      data-testid="section-title"
      className={clsx(
        "sig-section-title",
        `sig-section-title--${size}`,
        className,
      )}
      {...rest}
    >
      {children}
    </h2>
  );
}

export interface OverlineProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: ReactNode;
}

/**
 * Overline / kicker — the small, faint, wide-tracked uppercase label placed
 * above a title. Purely presentational (`<p>`).
 */
export function Overline({
  className,
  children,
  ...rest
}: OverlineProps): ReactNode {
  return (
    <p
      data-testid="overline"
      className={clsx("sig-overline", className)}
      {...rest}
    >
      {children}
    </p>
  );
}
