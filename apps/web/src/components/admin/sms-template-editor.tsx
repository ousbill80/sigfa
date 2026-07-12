/**
 * SmsTemplateEditor — per-event SMS template editor with live preview (WEB-006).
 *
 * The editor renders a live preview substituting the sample values for the
 * allowed variables ({{number}}, {{position}}, {{estimate}} — the LAW). Any
 * variable outside that set (e.g. {{agentName}}, or the story's {{ticket}}
 * before mapping) is flagged inline and blocks saving (it would 422 as
 * UNKNOWN_TEMPLATE_VARIABLE). v2 « Sérénité Premium » — @sigfa/ui + tokens only.
 * @module components/admin/sms-template-editor
 */
"use client";

import { useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { Badge, Button } from "@sigfa/ui";
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
const textareaStyle: CSSProperties = {
  width: "100%",
  minHeight: "5.5rem",
  padding: "var(--space-3)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-md)",
  backgroundColor: "var(--surface-2)",
  color: "var(--ink)",
  fontFamily: "var(--font-text)",
  fontSize: "var(--text-md)",
  lineHeight: "var(--leading-body)",
  boxSizing: "border-box",
  resize: "vertical",
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
    <section data-testid="sms-template-editor" aria-label={eventType} style={{ maxWidth: "32rem" }}>
      <p style={overlineStyle}>{t("admin.section.sms_templates", locale)}</p>

      <label htmlFor="template-input" style={labelStyle}>
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
        <div
          data-testid="template-unknown-var"
          role="alert"
          style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center", fontSize: "var(--text-sm)", color: "var(--ink-soft)", marginTop: "var(--space-3)" }}
        >
          <Badge tone="danger" dot>{t("admin.unknown_variable", locale)}</Badge>
          <span>{unknown.map((v) => `{{${v}}}`).join(", ")}</span>
        </div>
      )}

      <div style={{ marginTop: "var(--space-4)" }}>
        <div style={labelStyle}>{t("admin.preview", locale)}</div>
        <div
          data-testid="template-preview"
          style={{
            padding: "var(--space-3) var(--space-4)",
            backgroundColor: "var(--brand-soft)",
            borderRadius: "var(--r-md)",
            color: "var(--ink)",
            fontSize: "var(--text-md)",
            lineHeight: "var(--leading-body)",
          }}
        >
          {preview}
        </div>
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <Button
          type="button"
          variant="primary"
          data-testid="template-save"
          disabled={!valid}
          onClick={() => valid && onSave({ type: eventType, content })}
        >
          {t("admin.save", locale)}
        </Button>
      </div>
    </section>
  );
}
