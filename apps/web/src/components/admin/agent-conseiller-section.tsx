/**
 * AgentConseillerSection — marquer/démarquer un agent comme conseiller (MODEL-WEB-B).
 *
 * Étend la section « Agents » de la console admin (à côté de l'import CSV) : on
 * charge un agent (GET /agents/{id}), on active/désactive le flag conseiller
 * (`isRelationshipManager`), on saisit le `displayName` (nom public affiché en
 * borne) et un `photoUrl` optionnel, puis on enregistre via PATCH /agents/{id}
 * (routes CANONIQUES du contrat @sigfa/contracts, D5). Validation INLINE (jamais
 * de modale) : `displayName` REQUIS dès que conseiller est activé (message
 * humain). L'UI indique clairement que le nom + la photo apparaissent sur la borne.
 * @module components/admin/agent-conseiller-section
 */
"use client";

import { useState, type CSSProperties, type FormEvent, type ReactElement } from "react";
import { Badge, Button, Field } from "@sigfa/ui";
import {
  validateConseiller,
  isValid,
  type ConseillerDraft,
  type FieldErrors,
} from "@/lib/admin-validation";
import type { AgentProfileRow, UpdateConseillerBody } from "@/lib/use-admin-console";
import { t, type Locale } from "@/lib/i18n";

/** Props for {@link AgentConseillerSection}. */
export interface AgentConseillerSectionProps {
  /** Loads an agent profile by id (GET /agents/{id}); undefined error → not loaded. */
  onLoadAgent: (id: string) => Promise<{ ok: boolean; agent?: AgentProfileRow; message?: string }>;
  /** Persists the conseiller fields (PATCH /agents/{id}); resolves ok/message. */
  onSave: (id: string, body: UpdateConseillerBody) => Promise<{ ok: boolean; message?: string }>;
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
  margin: "0 0 var(--space-2)",
};
const introStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  margin: "0 0 var(--space-6)",
};
const rowStyle: CSSProperties = { marginBottom: "var(--space-4)" };
const errorStyle: CSSProperties = { fontSize: "var(--text-sm)", color: "var(--danger)", marginTop: "var(--space-1)" };
const serverErrorStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--danger)",
  backgroundColor: "var(--danger-soft)",
  border: "1px solid var(--danger)",
  borderRadius: "var(--r-md)",
  padding: "var(--space-3) var(--space-4)",
  marginBottom: "var(--space-4)",
};
const noticeStyle: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: "var(--ink-soft)",
  backgroundColor: "var(--surface-2)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--r-md)",
  padding: "var(--space-3) var(--space-4)",
  margin: "0 0 var(--space-4)",
};
const toggleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  marginBottom: "var(--space-4)",
};

/**
 * Conseiller marking sub-management for a single agent.
 * @param props - {@link AgentConseillerSectionProps}.
 * @returns The section element.
 */
export function AgentConseillerSection({
  onLoadAgent,
  onSave,
  locale = "fr",
}: AgentConseillerSectionProps): ReactElement {
  const [agentId, setAgentId] = useState("");
  const [loaded, setLoaded] = useState<AgentProfileRow | null>(null);
  const [isConseiller, setIsConseiller] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  async function handleLoad(): Promise<void> {
    setServerError(undefined);
    setSaved(false);
    setErrors({});
    const r = await onLoadAgent(agentId.trim());
    if (r.ok && r.agent) {
      setLoaded(r.agent);
      setIsConseiller(r.agent.isRelationshipManager);
      setDisplayName(r.agent.displayName ?? "");
      setPhotoUrl(r.agent.photoUrl ?? "");
    } else {
      setLoaded(null);
      setServerError(r.message);
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!loaded) return;
    setSaved(false);
    setServerError(undefined);
    const draft: ConseillerDraft = { isRelationshipManager: isConseiller, displayName, photoUrl };
    const found = validateConseiller(draft);
    setErrors(found);
    if (!isValid(found)) return;

    const trimmedName = displayName.trim();
    const trimmedPhoto = photoUrl.trim();
    const body: UpdateConseillerBody = {
      isRelationshipManager: isConseiller,
      ...(isConseiller && trimmedName !== "" ? { displayName: trimmedName } : {}),
      ...(isConseiller ? { photoUrl: trimmedPhoto !== "" ? trimmedPhoto : null } : {}),
    };
    const r = await onSave(loaded.id, body);
    if (r.ok) setSaved(true);
    else setServerError(r.message);
  }

  return (
    <section data-testid="agent-conseiller-section" aria-label={t("admin.conseiller.title", locale)}>
      <p style={overlineStyle}>{t("admin.conseiller.title", locale)}</p>
      <p style={introStyle}>{t("admin.conseiller.intro", locale)}</p>

      <div style={rowStyle}>
        <Field
          id="conseiller-agent-id"
          data-testid="conseiller-agent-id"
          label={t("admin.conseiller.agent_id", locale)}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
        />
        <div style={{ marginTop: "var(--space-2)" }}>
          <Button
            type="button"
            variant="secondary"
            size="dense"
            data-testid="conseiller-load"
            disabled={agentId.trim() === ""}
            onClick={() => void handleLoad()}
          >
            {t("admin.conseiller.load", locale)}
          </Button>
        </div>
      </div>

      {serverError && !loaded && (
        <div data-testid="conseiller-server-error" role="alert" style={serverErrorStyle}>
          {serverError}
        </div>
      )}

      {loaded && (
        <form data-testid="conseiller-form" onSubmit={(e) => void handleSubmit(e)} noValidate style={{ maxWidth: "28rem" }}>
          <p style={{ ...overlineStyle, marginTop: "var(--space-2)" }}>
            {loaded.firstName || loaded.lastName
              ? `${loaded.firstName ?? ""} ${loaded.lastName ?? ""}`.trim()
              : loaded.id}{" "}
            <Badge tone={isConseiller ? "success" : "info"} dot>
              {isConseiller ? t("admin.conseiller.marked", locale) : t("admin.conseiller.unmarked", locale)}
            </Badge>
          </p>

          <div style={noticeStyle} data-testid="conseiller-kiosk-notice">
            {t("admin.conseiller.kiosk_notice", locale)}
          </div>

          {serverError && (
            <div data-testid="conseiller-server-error" role="alert" style={serverErrorStyle}>
              {serverError}
            </div>
          )}

          <label style={toggleRowStyle}>
            <input
              type="checkbox"
              data-testid="conseiller-toggle"
              checked={isConseiller}
              onChange={(e) => {
                setIsConseiller(e.target.checked);
                setSaved(false);
                if (!e.target.checked) setErrors((prev) => ({ ...prev, displayName: "" }));
              }}
            />
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--ink)" }}>
              {t("admin.conseiller.toggle", locale)}
            </span>
          </label>

          {isConseiller && (
            <>
              <div style={rowStyle}>
                <Field
                  id="conseiller-display-name"
                  data-testid="conseiller-display-name"
                  label={t("admin.conseiller.display_name", locale)}
                  hint={t("admin.conseiller.display_name_hint", locale)}
                  aria-required="true"
                  aria-invalid={errors.displayName ? true : undefined}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                {errors.displayName && (
                  <p data-testid="error-conseiller-display-name" role="alert" style={errorStyle}>
                    {errors.displayName}
                  </p>
                )}
              </div>

              <div style={rowStyle}>
                <Field
                  id="conseiller-photo-url"
                  data-testid="conseiller-photo-url"
                  label={t("admin.conseiller.photo_url", locale)}
                  hint={t("admin.conseiller.photo_url_hint", locale)}
                  aria-invalid={errors.photoUrl ? true : undefined}
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                />
                {errors.photoUrl && (
                  <p data-testid="error-conseiller-photo-url" role="alert" style={errorStyle}>
                    {errors.photoUrl}
                  </p>
                )}
              </div>
            </>
          )}

          {saved && (
            <div data-testid="conseiller-saved" role="status" style={{ ...noticeStyle, borderColor: "var(--success)", color: "var(--ink)" }}>
              {t("admin.conseiller.saved", locale)}
            </div>
          )}

          <Button type="submit" variant="primary" data-testid="conseiller-submit">
            {t("admin.save", locale)}
          </Button>
        </form>
      )}
    </section>
  );
}
