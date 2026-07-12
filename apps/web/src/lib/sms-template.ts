/**
 * sms-template.ts — SMS template variable rendering & validation (WEB-006).
 *
 * The LAW (admin.yaml PATCH /banks/{id}/sms-templates) restricts the allowed
 * variables to EXACTLY `{{number}}`, `{{position}}`, `{{estimate}}`. Any other
 * token (including the story-mentioned `{{ticket}}` / `{{agency}}`) is an
 * UNKNOWN_TEMPLATE_VARIABLE → the server answers 422, so the console must catch
 * it client-side and refuse to send. The `{{number}}` variable is the ticket
 * display number (the story's "{{ticket}}" intent maps to the contract's
 * `{{number}}`).
 *
 * `renderPreview` substitutes sample values so BANK_ADMIN sees the final SMS.
 * @module lib/sms-template
 */

/** Notification event types (core.yaml NotificationType, SMS-relevant subset). */
export type SmsEventType = "TICKET_CONFIRMATION" | "POSITION_UPDATE" | "YOUR_TURN";

/** The exact set of variables allowed by the contract. */
export const ALLOWED_VARIABLES = ["number", "position", "estimate"] as const;
export type AllowedVariable = (typeof ALLOWED_VARIABLES)[number];

/** Sample values used to render the live preview. */
export const PREVIEW_SAMPLE: Record<AllowedVariable, string> = {
  number: "A-047",
  position: "3",
  estimate: "12",
};

const VARIABLE_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Extracts every `{{var}}` token name found in a template body.
 * @param content - The template body.
 * @returns Distinct variable names in order of appearance.
 */
export function extractVariables(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(VARIABLE_RE)) {
    const name = match[1]!;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * Returns the variables present in the template that are NOT allowed by the
 * contract (would trigger a 422 UNKNOWN_TEMPLATE_VARIABLE if sent).
 * @param content - The template body.
 * @returns The unknown variable names (empty when the template is valid).
 */
export function unknownVariables(content: string): string[] {
  return extractVariables(content).filter(
    (v) => !(ALLOWED_VARIABLES as readonly string[]).includes(v),
  );
}

/**
 * Whether a template body only uses allowed variables and is within 1–160 chars.
 * @param content - The template body.
 * @returns true if the template can be sent to the contract.
 */
export function isTemplateValid(content: string): boolean {
  if (content.length < 1 || content.length > 160) return false;
  return unknownVariables(content).length === 0;
}

/**
 * Renders a live preview by substituting the sample values into the allowed
 * variables. Unknown variables are left verbatim (they are flagged separately).
 * @param content - The template body.
 * @param sample - Optional sample values (defaults to {@link PREVIEW_SAMPLE}).
 * @returns The rendered SMS text.
 */
export function renderPreview(
  content: string,
  sample: Record<string, string> = PREVIEW_SAMPLE,
): string {
  return content.replace(VARIABLE_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(sample, name) ? sample[name]! : whole,
  );
}
