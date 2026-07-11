/**
 * KIOSK-003 — useAccessibilityMode hook
 * Stores accessibility mode in sessionStorage.
 */
"use client";

import { useState } from "react";

export interface AccessibilityMode {
  isAccessibilityMode: boolean;
  toggleAccessibilityMode: () => void;
}

const SESSION_KEY = "kiosk_accessibility_mode";

export function useAccessibilityMode(): AccessibilityMode {
  const [isAccessibilityMode, setIsAccessibilityMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(SESSION_KEY) === "true";
  });

  const toggleAccessibilityMode = () => {
    setIsAccessibilityMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_KEY, String(next));
      }
      return next;
    });
  };

  return { isAccessibilityMode, toggleAccessibilityMode };
}
