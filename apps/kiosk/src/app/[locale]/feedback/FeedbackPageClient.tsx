/**
 * KIOSK-009 — FeedbackPageClient
 * Lit le trackingId depuis l'URL et rend l'écran feedback.
 */
"use client";

import { useSearchParams } from "next/navigation";
import { FeedbackScreen } from "@/components/FeedbackScreen";
import { useAccessibilityMode } from "@/hooks/useAccessibilityMode";

export function FeedbackPageClient() {
  const searchParams = useSearchParams();
  const trackingId = searchParams.get("trackingId") ?? "";
  const { isAccessibilityMode } = useAccessibilityMode();

  return (
    <FeedbackScreen
      trackingId={trackingId}
      isAccessibilityMode={isAccessibilityMode}
    />
  );
}
