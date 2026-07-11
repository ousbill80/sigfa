/**
 * KIOSK-002 — useInactivityTimeout hook
 * Calls onTimeout after delayMs of inactivity.
 * Resets on touchstart, mousemove, keydown events.
 */
"use client";

import { useEffect, useRef } from "react";

export function useInactivityTimeout(
  onTimeout: () => void,
  delayMs: number
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    const reset = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        onTimeoutRef.current();
      }, delayMs);
    };

    const events = ["touchstart", "mousemove", "keydown"] as const;
    events.forEach((event) => window.addEventListener(event, reset));

    // Start the initial timer
    reset();

    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [delayMs]);
}
