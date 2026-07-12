/**
 * SmsTemplateEditor — per-event SMS template editor with live preview (WEB-006).
 *
 * The editor renders a live preview substituting the sample values for the
 * allowed variables ({{number}}, {{position}}, {{estimate}} — the LAW). Any
 * variable outside that set (e.g. {{agentName}}, or the story's {{ticket}}
 * before mapping) is flagged inline and blocks saving (it would 422 as
 * UNKNOWN_TEMPLATE_VARIABLE). Tokens only.
 * @module components/admin/sms-template-editor
 */
"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import {
  renderPreview,
  unknownVariables,
  isTemplateValid,
  type SmsEventType,
} from "@/lib/sms-template";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link SmsTemplateEditor}. */
export interface SmsTemplateEditorProps {
  /** The notification event this template targets. */
  eventType: SmsEventType;
  /** Initial template body. */
  initialContent: string;
  /** Persists the template (PATCH /banks/{id}/sms-templates). */
  onSave: (template: { type: SmsEventType; content: string }) => void;
  /** Active locale. */
  locale?: Locale;
}

const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "5rem",
  padding: "0.5rem",
  border: "1px solid var(--ink-soft)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--surface-0)",
  color: "var(--ink-strong)",
  fontSize: "1rem",
};

/**
 * SMS template editor with live preview.
 * @param props - {@link SmsTemplateEditorProps}.
 * @returns The editor element.
 */
export function SmsTemplateEditor({ eventType, initialContent, onSave, locale = "fr" }: SmsTemplateEditorProps): ReactElement {
  const [content, setContent] = useState(initialContent);

  const { preview, unknown, valid } = useMemo(
    () => ({
      preview: renderPreview(content),
      unknown: unknownVariables(content),
      valid: isTemplateValid(content),
    }),
    [content],
  );

  return (
    <section data-testid="sms-template-editor" aria-label={eventType}>
      <label htmlFor="template-input" style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>
        {eventType}
      </label>
      <textarea
        id="template-input"
        data-testid="template-input"
        style={textareaStyle}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={160}
      />

      {unknown.length > 0 && (
        <div data-testid="template-unknown-var" role="alert" style={{ fontSize: "var(--caption)", color: "var(--danger)", marginTop: "0.25rem" }}>
          {t("admin.unknown_variable", locale)} : {unknown.map((v) => `{{${v}}}`).join(", ")}
        </div>
      )}

      <div style={{ marginTop: "0.5rem" }}>
        <div style={{ fontSize: "var(--caption)", color: "var(--ink-soft)" }}>{t("admin.preview", locale)}</div>
        <div
          data-testid="template-preview"
          style={{ padding: "0.5rem", backgroundColor: "var(--surface-1)", borderRadius: "0.375rem", color: "var(--ink-strong)" }}
        >
          {preview}
        </div>
      </div>

      <button
        type="button"
        data-testid="template-save"
        disabled={!valid}
        onClick={() => valid && onSave({ type: eventType, content })}
        style={{
          marginTop: "0.75rem",
          minHeight: "40px",
          padding: "0 1rem",
          border: "none",
          borderRadius: "0.375rem",
          backgroundColor: valid ? "var(--brand)" : "var(--surface-1)",
          color: valid ? "var(--brand-contrast)" : "var(--ink-soft)",
          cursor: valid ? "pointer" : "not-allowed",
          fontSize: "1rem",
        }}
      >
        {t("admin.save", locale)}
      </button>
    </section>
  );
}
