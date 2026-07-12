/**
 * Layout for the /design-preview gallery. Imports the @sigfa/ui design-system
 * stylesheets (tokens + self-hosted fonts + component styles) and the gallery's
 * own layout CSS. Scoped to this route: it does NOT alter any other web screen.
 *
 * @module app/design-preview/layout
 */
import type { ReactElement, ReactNode } from "react";
import "@sigfa/ui/tokens.css";
import "@sigfa/ui/fonts.css";
import "@sigfa/ui/components.css";
import "./preview.css";

export default function DesignPreviewLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <>{children}</>;
}
