/**
 * AgentsImport — CSV agent import panel with a per-line summary (WEB-006).
 *
 * The file is uploaded to POST /agents/import (agents.yaml). The returned
 * ImportReport is shown as "N créés / M ignorés / K erreurs" with a per-line
 * motive (the human `message`, never the raw `code`). Tokens only.
 * @module components/admin/agents-import-panel
 */
"use client";

import { type ChangeEvent, type CSSProperties, type ReactElement } from "react";
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

const rowStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  padding: "0.375rem 0",
  borderBottom: "1px solid var(--surface-1)",
  fontSize: "var(--caption)",
  color: "var(--ink-strong)",
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
      <label htmlFor="agents-file" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>
        {t("admin.import_csv", locale)}
      </label>
      <input id="agents-file" data-testid="agents-file" type="file" accept=".csv,text/csv" onChange={handleFile} />

      {summary && (
        <div style={{ marginTop: "0.75rem" }}>
          <div data-testid="import-summary" style={{ color: "var(--ink-strong)", fontWeight: 600 }}>
            {t("admin.import_summary", locale)} : {summaryLine(summary)}
          </div>
          {summary.errors.length > 0 && (
            <ul data-testid="import-errors" style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }}>
              {summary.errors.map((err, i) => (
                <li key={`${err.line}-${i}`} data-testid={`import-error-row-${i}`} style={rowStyle}>
                  <span style={{ color: "var(--danger)" }}>L.{err.line}</span>
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
