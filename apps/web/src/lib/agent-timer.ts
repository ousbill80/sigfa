/**
 * Agent service timer helpers (WEB-002).
 * MM:SS formatting and a second-ticking timer hook that resets on each call.
 * @module lib/agent-timer
 */
"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Formats a positive number of seconds as MM:SS (zero-padded).
 * Negative inputs are clamped to 0.
 * @param totalSeconds - Elapsed seconds.
 * @returns MM:SS string (ex. "03:47").
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Ticking service timer. Starts at 00:00 when `runningSince` changes to a new
 * key, increments every second, and continues locally even offline (WEB-002).
 *
 * @param runningSince - A key that changes when a new ticket is called; passing
 *   null stops/hides the timer (returns "00:00").
 * @returns The current elapsed time as MM:SS.
 */
export function useTicketTimer(runningSince: number | string | null): string {
  const [elapsed, setElapsed] = useState(0);
  const keyRef = useRef<number | string | null>(runningSince);

  useEffect(() => {
    // Reset to 00:00 whenever a new ticket is called.
    keyRef.current = runningSince;
    setElapsed(0);
    if (runningSince === null) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [runningSince]);

  return formatDuration(elapsed);
}
