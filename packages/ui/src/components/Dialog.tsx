/**
 * Dialog — SIGFA v2 modal. Accessible: `role="dialog"` + `aria-modal`, labelled
 * by its title, Escape closes, backdrop click closes, and focus moves to the
 * panel on open. Text/actions come from props (i18n-agnostic).
 *
 * @module components/Dialog
 */
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { clsx } from "clsx";

export interface DialogProps {
  /** Controls visibility. */
  open: boolean;
  /** Called when the user dismisses (Escape / backdrop / close action). */
  onClose: () => void;
  /** Dialog title (also used as the accessible name). */
  title: string;
  /** Body content. */
  children?: ReactNode;
  /** Footer actions (e.g. Cancel / Confirm buttons). */
  actions?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  className,
}: DialogProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  function handleBackdrop(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <div
      className="sig-dialog__backdrop"
      onMouseDown={handleBackdrop}
      data-testid="dialog-backdrop"
    >
      <div
        ref={panelRef}
        className={clsx("sig-dialog", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="sig-dialog__title">
          {title}
        </h2>
        {children != null && <div className="sig-dialog__body">{children}</div>}
        {actions != null && (
          <div className="sig-dialog__actions">{actions}</div>
        )}
      </div>
    </div>
  );
}
