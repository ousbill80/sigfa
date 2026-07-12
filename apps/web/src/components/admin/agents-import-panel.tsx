/**
 * AgentsImport — CSV agent import panel with a per-line summary (WEB-006).
 *
 * The file is uploaded to POST /agents/import (agents.yaml). The returned
 * ImportReport is shown as "N créés / M ignorés / K erreurs" with a per-line
 * motive (the human `message`, never the raw `code`).
 * v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 * @module components/admin/agents-import-panel
 */
"use client";

import { type ChangeEvent, type CSSProperties, type ReactElement } from "react";
import { Badge } from "@sigfa/ui";
import type { ImportSummary } from "@/lib/agents-import";
import { summaryLine } from "@/lib/agents-import";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link AgentsImport}. */
export interface AgentsImportProps {
  /** Called with the selected CSV file. */
  onImport: (file: File) => void;
  /** The import summary to display (null before any import). */
  summary?: ImportSummary | null;
  /** Active locale. */
  locale?: Locale;
}

const overlineStyle: CSSProperties = {
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-faint)",
  margin: "0 0 var(--space-4)",
};
const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "var(--text-sm)",
  fontWeight: 600,
  color: "var(--ink-soft)",
  marginBottom: "var(--space-2)",
};
const dropStyle: CSSProperties = {
  border: "1px dashed var(--hairline)",
  borderRadius: "var(--r-md)",
  backgroundColor: "var(--surface-2)",
  padding: "var(--space-4)",
};
const rowStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-3)",
  alignItems: "center",
  padding: "var(--space-2) 0",
  borderBottom: "1px solid var(--hairline)",
  fontSize: "var(--text-sm)",
  color: "var(--ink)",
};

/**
 * CSV agent import panel.
 * @param props - {@link AgentsImportProps}.
 * @returns The panel element.
 */
export function AgentsImport({ onImport, summary, locale = "fr" }: AgentsImportProps): ReactElement {
  function handleFile(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) onImport(file);
  }

  return (
    <section data-testid="agents-import" aria-label={t("admin.import_csv", locale)}>
      <p style={overlineStyle}>{t("admin.section.agents", locale)}</p>

      <label htmlFor="agents-file" style={labelStyle}>
        {t("admin.import_csv", locale)}
      </label>
      <div style={dropStyle}>
        <input id="agents-file" data-testid="agents-file" type="file" accept=".csv,text/csv" onChange={handleFile} />
      </div>

      {summary && (
        <div style={{ marginTop: "var(--space-6)" }}>
          <div
            data-testid="import-summary"
            style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center", color: "var(--ink)", fontWeight: 600 }}
          >
            <span style={{ color: "var(--ink-soft)", fontWeight: 500 }}>{t("admin.import_summary", locale)} :</span>
            <Badge tone="success">{summaryLine(summary)}</Badge>
          </div>
          {summary.errors.length > 0 && (
            <ul data-testid="import-errors" style={{ listStyle: "none", padding: 0, marginTop: "var(--space-4)" }}>
              {summary.errors.map((err, i) => (
                <li key={`${err.line}-${i}`} data-testid={`import-error-row-${i}`} style={rowStyle}>
                  <Badge tone="danger" dot>L.{err.line}</Badge>
                  {err.field && <span style={{ color: "var(--ink-soft)" }}>{err.field}</span>}
                  <span>{err.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
