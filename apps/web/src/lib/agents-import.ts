/**
 * agents-import.ts — CSV import report model (WEB-006).
 *
 * The actual parsing/validation happens server-side: the console POSTs the file
 * to `POST /agents/import` (agents.yaml, multipart field `file`, AGENCY_DIRECTOR+)
 * and receives an ImportReport `{ created, skipped, errors: [{ line, field, code,
 * message }] }`. This module normalises that report into a display summary
 * "N créés / M ignorés / K erreurs (motif par ligne)". The per-line message is
 * taken from the human `message` field (never the raw `code`).
 * @module lib/agents-import
 */

/** A single per-line import error as returned by the contract. */
export interface ImportRowError {
  line: number;
  field?: string;
  code?: string;
  message: string;
}

/** The contract ImportReport shape (agents.yaml). */
export interface ImportReport {
  created: number;
  skipped: number;
  errors: ImportRowError[];
}

/** A normalised, display-ready import summary. */
export interface ImportSummary {
  created: number;
  skipped: number;
  errorCount: number;
  errors: ImportRowError[];
}

/**
 * Coerces an unknown API payload into a safe ImportSummary.
 * Missing/invalid fields default to 0 / [] so the UI never crashes.
 * @param data - The raw response body from POST /agents/import.
 * @returns A normalised summary.
 */
export function toImportSummary(data: unknown): ImportSummary {
  const report = data as Partial<ImportReport> | null | undefined;
  const created = typeof report?.created === "number" ? report.created : 0;
  const skipped = typeof report?.skipped === "number" ? report.skipped : 0;
  const rawErrors = Array.isArray(report?.errors) ? report!.errors : [];
  const errors: ImportRowError[] = rawErrors
    .filter((e): e is ImportRowError => typeof e?.line === "number" && typeof e?.message === "string")
    .map((e) => ({ line: e.line, field: e.field, code: e.code, message: e.message }));
  return { created, skipped, errorCount: errors.length, errors };
}

/**
 * A one-line human summary "N créés / M ignorés / K erreurs".
 * @param summary - The normalised import summary.
 * @returns The summary sentence.
 */
export function summaryLine(summary: ImportSummary): string {
  return `${summary.created} créés / ${summary.skipped} ignorés / ${summary.errorCount} erreurs`;
}
